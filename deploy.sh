#!/usr/bin/env bash
# Immutable static releases; no new daemon or public port.
set -euo pipefail
cd -- "$(dirname -- "$0")"
command -v node >/dev/null || { echo 'Node >=20 required. Run: nix shell nixpkgs#nodejs --command ./deploy.sh' >&2; exit 1; }
if [[ -n $(git status --porcelain) ]]; then echo 'Commit changes before deploying an identifiable release.' >&2; exit 1; fi
node --test test/*.test.mjs
revision=$(git rev-parse HEAD)
release="/srv/http/driftline/releases/$revision"
config=/etc/caddy/conf.d/driftline.freifick.net.caddy
sudo install -d -m 0755 /srv/http/driftline /srv/http/driftline/releases "$release"
for file in web/*; do sudo install -m 0644 "$file" "$release/"; done
backup=$(mktemp)
had_config=false
if sudo test -f "$config"; then sudo cat "$config" > "$backup"; had_config=true; fi
trap 'rm -f "$backup"' EXIT
sudo install -m 0644 deploy/driftline.caddy "$config"
if ! sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
  if "$had_config"; then sudo install -m 0644 "$backup" "$config"; else sudo rm -f "$config"; fi
  exit 1
fi
previous=$(readlink /srv/http/driftline/current || true)
sudo ln -sfn "$release" /srv/http/driftline/current.new
sudo mv -Tf /srv/http/driftline/current.new /srv/http/driftline/current
if ! sudo systemctl reload caddy; then
  if [[ -n "$previous" ]]; then sudo ln -sfn "$previous" /srv/http/driftline/current.new; sudo mv -Tf /srv/http/driftline/current.new /srv/http/driftline/current; fi
  if "$had_config"; then sudo install -m 0644 "$backup" "$config"; else sudo rm -f "$config"; fi
  exit 1
fi
printf 'Installed %s at https://driftline.freifick.net\n' "$revision"
