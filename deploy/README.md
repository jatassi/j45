# J45 VPS bootstrap

One-time setup for the J45 production VPS (ssh alias `vps`). Run each block
once, in order. After bootstrap is done, deploying is just
`git push deploy main` from your laptop — no step below "Bootstrap complete"
ever needs `sudo`.

Everything here targets `j45.atassi.org`, internal port `4517` (matches
`deploy/config.sh`), with Bun already installed on the VPS at
`~/.bun/bin/bun`.

## 1. DNS — grey-cloud A record

In Cloudflare, add an A record for `j45.atassi.org` pointing at the VPS's
public IP, with the proxy **off** (grey cloud, "DNS only") — Caddy handles
TLS directly, so Cloudflare must not proxy this record.

```
Type:          A
Name:          j45
Content:       <VPS public IP>
Proxy status:  DNS only (grey cloud)
TTL:           Auto
```

## 2. Create `/opt/j45` (sudo)

The only sudo in this whole doc, besides the Caddy step below: creating the
directory and handing ownership to your VPS user so every step after this
one runs unprivileged.

```sh
ssh vps 'sudo mkdir -p /opt/j45 && sudo chown $USER /opt/j45'
```

Final layout under `/opt/j45` (created over the next steps):

```
/opt/j45/repo.git/           bare git repo — push target; hooks/ holds the deploy hook
/opt/j45/app/                 working checkout of the pushed ref (post-receive hook)
/opt/j45/data/j45.sqlite      server's SQLite database
/opt/j45/release.env          written by the hook on every deploy: RELEASE_SHA, PORT, DB_PATH
```

## 3. Bare repo + deploy hook (no sudo)

Initialize the bare repo, then install the hook (`deploy/post-receive`) and
its config (`deploy/config.sh`) from this repo into the bare repo's `hooks/`
directory.

```sh
ssh vps 'git init --bare /opt/j45/repo.git'
```

```sh
scp deploy/config.sh vps:/opt/j45/repo.git/hooks/config.sh
scp deploy/post-receive vps:/opt/j45/repo.git/hooks/post-receive
ssh vps 'chmod +x /opt/j45/repo.git/hooks/post-receive'
```

## 4. systemd user unit + linger (no sudo)

Install `deploy/j45.service` as a systemd **user** unit (not a system unit —
that's how J45 avoids needing sudo to restart the server on every deploy,
unlike the legacy app). `loginctl enable-linger` makes the user unit keep
running after you log out of the ssh session.

```sh
ssh vps 'mkdir -p ~/.config/systemd/user'
scp deploy/j45.service vps:~/.config/systemd/user/j45.service
ssh vps 'systemctl --user daemon-reload && systemctl --user enable j45'
```

```sh
ssh vps 'loginctl enable-linger $USER'
```

## 5. Caddy site block (sudo)

Add a site block to the VPS's Caddyfile (`/etc/caddy/Caddyfile`) reverse
proxying `j45.atassi.org` to the internal port, then reload Caddy. Both of
these touch system-owned files/services, so they need sudo.

```
j45.atassi.org {
	reverse_proxy 127.0.0.1:4517
}
```

```sh
ssh vps 'sudo tee -a /etc/caddy/Caddyfile <<'"'"'EOF'"'"'

j45.atassi.org {
	reverse_proxy 127.0.0.1:4517
}
EOF
sudo systemctl reload caddy'
```

## Bootstrap complete — everything below is sudo-free

## 6. Laptop: add the deploy remote

```sh
git remote add deploy vps:/opt/j45/repo.git
```

## 7. First deploy

```sh
git push deploy main
```

The `post-receive` hook checks out the pushed SHA into `/opt/j45/app`, runs
`bun install --frozen-lockfile` and `bun run build`, writes
`/opt/j45/release.env`, restarts the server with
`systemctl --user restart j45`, and polls `http://127.0.0.1:4517/healthz`
until it serves the pushed SHA (failing loudly if it doesn't within ~20s).
No sudo anywhere in this flow — restarting, rebuilding, and re-deploying are
all systemd `--user` and normal file operations under `/opt/j45`, which you
already own from step 2.

Rollback is the same push, to an older SHA:

```sh
git push -f deploy <last-good-sha>:main
```
