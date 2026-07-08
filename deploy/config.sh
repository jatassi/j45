# shellcheck shell=bash
# Production deploy configuration for the J45 VPS.
#
# Sourced by deploy/post-receive (installed into /opt/j45/repo.git/hooks/).
# The local simulation (scripts/deploy-sim.sh) generates its OWN copy of this
# file with sim values so the *identical* hook runs in both places — the only
# thing that differs between prod and the sim is this config.
#
# VPS layout (see docs/designs/walking-skeleton/design.md):
#   /opt/j45/repo.git   bare repo (this hook lives in hooks/)
#   /opt/j45/app        checkout target ($APP_DIR)
#   /opt/j45/data       sqlite home ($DATA_DIR)
#   /opt/j45/release.env  written by the hook, read by j45.service

# Where the pushed ref is checked out to.
APP_DIR="/opt/j45/app"

# Directory holding the sqlite database.
DATA_DIR="/opt/j45/data"

# Absolute path to the sqlite database (written into release.env as DB_PATH).
DB_PATH="/opt/j45/data/j45.sqlite"

# Internal port the server listens on (reverse-proxied by Caddy). 4517.
PORT=4517

# The env file the hook writes and j45.service reads via EnvironmentFile.
RELEASE_ENV="/opt/j45/release.env"

# How the hook restarts the server after a successful build. The systemd user
# service means this never needs sudo.
RESTART_CMD="systemctl --user restart j45"

# Health endpoint the hook polls to confirm the freshly-deployed SHA is live.
HEALTH_URL="http://127.0.0.1:4517/healthz"
