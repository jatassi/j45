#!/usr/bin/env bash
#
# Local simulated VPS deploy — the acceptance test for the git-push deploy
# pipeline (wired as `bun run deploy:sim`). It runs the IDENTICAL production
# hook (deploy/post-receive) against a throwaway bare repo, so the sim is how
# the hook is validated without touching the real VPS.
#
# It:
#   1. sanity-checks the shipped prod artifacts (config.sh vars, the hook's
#      PATH export, the systemd unit's EnvironmentFile + port 4517),
#   2. builds a temp bare repo + APP_DIR/DATA_DIR and installs the real hook
#      with a sim config whose RESTART_CMD manages a background bun process on
#      an ephemeral port,
#   3. pushes HEAD and asserts /healthz serves the pushed SHA,
#   4. force-pushes the prior SHA and asserts /healthz serves that prior SHA.
#
# Exits 0 only if both healthz assertions hold.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$REPO_ROOT/deploy"

fail() {
  echo "deploy:sim FAILED — $*" >&2
  exit 1
}

# --- 1. shipped-artifact sanity checks -------------------------------------

# criterion 1: the prod config supplies every knob the hook needs.
for var in APP_DIR DATA_DIR DB_PATH PORT RELEASE_ENV RESTART_CMD HEALTH_URL; do
  grep -Eq "^${var}=" "$DEPLOY_DIR/config.sh" \
    || fail "deploy/config.sh is missing $var"
done

# criterion 2: the hook survives non-interactive VPS shells (bun on PATH).
grep -q 'export PATH="\$HOME/.bun/bin:\$PATH"' "$DEPLOY_DIR/post-receive" \
  || fail "deploy/post-receive does not export the bun PATH"
grep -q 'config.sh' "$DEPLOY_DIR/post-receive" \
  || fail "deploy/post-receive does not source config.sh"

# criterion 3: the systemd user unit reads release.env and serves 4517.
grep -q '^EnvironmentFile=/opt/j45/release.env$' "$DEPLOY_DIR/j45.service" \
  || fail "deploy/j45.service is missing EnvironmentFile=/opt/j45/release.env"
grep -q '4517' "$DEPLOY_DIR/j45.service" \
  || fail "deploy/j45.service does not reference port 4517"

# --- 2. temp VPS ------------------------------------------------------------

WORK="$(mktemp -d "${TMPDIR:-/tmp}/j45-deploy-sim.XXXXXX")"
PIDFILE="$WORK/server.pid"

cleanup() {
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

BARE="$WORK/repo.git"
APP_DIR="$WORK/app"
DATA_DIR="$WORK/data"
RELEASE_ENV="$WORK/release.env"
mkdir -p "$APP_DIR" "$DATA_DIR"

git init --bare -q "$BARE"

# An ephemeral free port for the background server.
PORT="$(bun -e 'const s=Bun.serve({port:0,fetch(){return new Response("")}});const p=s.port;s.stop();process.stdout.write(String(p));')"
[ -n "$PORT" ] || fail "could not allocate an ephemeral port"
HEALTH_URL="http://127.0.0.1:$PORT/healthz"

# Install the REAL hook, unmodified.
cp "$DEPLOY_DIR/post-receive" "$BARE/hooks/post-receive"
chmod +x "$BARE/hooks/post-receive"

# Generate the sim config next to it — same variable contract as the prod
# config, but RESTART_CMD (re)starts a background bun process on $PORT.
cat > "$BARE/hooks/config.sh" <<EOF
APP_DIR="$APP_DIR"
DATA_DIR="$DATA_DIR"
DB_PATH="$DATA_DIR/j45.sqlite"
PORT=$PORT
RELEASE_ENV="$RELEASE_ENV"
HEALTH_URL="$HEALTH_URL"
RESTART_CMD="sim_restart"

SIM_PIDFILE="$PIDFILE"
SIM_LOG="$WORK/server.log"

sim_restart() {
  if [ -f "\$SIM_PIDFILE" ]; then
    kill "\$(cat "\$SIM_PIDFILE")" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "\$(cat "\$SIM_PIDFILE")" 2>/dev/null || break
      sleep 0.2
    done
  fi
  # release.env carries RELEASE_SHA/PORT/DB_PATH; export them for the server.
  set -a
  # shellcheck source=/dev/null
  . "\$RELEASE_ENV"
  set +a
  ( cd "\$APP_DIR/packages/server" && exec bun run src/main.ts ) \
    > "\$SIM_LOG" 2>&1 &
  echo \$! > "\$SIM_PIDFILE"
}
EOF

# --- assertions -------------------------------------------------------------

# The pushed and prior releases must both be fully self-consistent trees
# (client + server + matching lockfile), so build the pair from the committed
# HEAD: prior = HEAD, new = HEAD + an empty commit. Same content, distinct SHA
# — exactly what exercises SHA propagation and rollback.
SRC="$WORK/src"
git clone -q "$REPO_ROOT" "$SRC"
git -C "$SRC" config user.email "sim@j45.local"
git -C "$SRC" config user.name "j45 deploy sim"
PRIOR_SHA="$(git -C "$SRC" rev-parse HEAD)"
git -C "$SRC" commit -q --allow-empty -m "deploy:sim new release"
NEW_SHA="$(git -C "$SRC" rev-parse HEAD)"

served_sha() {
  curl -fsS "$HEALTH_URL" 2>/dev/null | sed -n 's/.*"sha":"\([^"]*\)".*/\1/p'
}

assert_serves() {
  local expected="$1"
  local got=""
  for _ in $(seq 1 30); do
    got="$(served_sha || true)"
    if [ "$got" = "$expected" ]; then
      echo "deploy:sim OK — $HEALTH_URL serving $expected"
      return 0
    fi
    sleep 0.5
  done
  fail "$HEALTH_URL served '${got:-<none>}', expected '$expected'"
}

echo "deploy:sim — pushing new release $NEW_SHA"
git -C "$SRC" push -q "$BARE" "$NEW_SHA:refs/heads/main"
assert_serves "$NEW_SHA"

# release.env must have been written with the pushed SHA / port / db path.
grep -q "^RELEASE_SHA=$NEW_SHA$" "$RELEASE_ENV" || fail "release.env missing RELEASE_SHA=$NEW_SHA"
grep -q "^PORT=$PORT$" "$RELEASE_ENV" || fail "release.env missing PORT=$PORT"
grep -q "^DB_PATH=$DATA_DIR/j45.sqlite$" "$RELEASE_ENV" || fail "release.env missing DB_PATH"

echo "deploy:sim — rolling back (force-push prior) $PRIOR_SHA"
git -C "$SRC" push -qf "$BARE" "$PRIOR_SHA:refs/heads/main"
assert_serves "$PRIOR_SHA"

echo "deploy:sim PASSED"
