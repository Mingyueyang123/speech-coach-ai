#!/usr/bin/env bash
set -euo pipefail

# First install only. Refuse existing deployments instead of replacing them.
archive=${1:?Pass the uploaded source tar.gz path}
base=/opt/speech-coach-ai
release=$base/releases/initial
node_version=22.23.3
node_archive=node-v${node_version}-linux-x64.tar.xz
[[ $(id -u) == 0 ]] || { printf 'Run with sudo.\n' >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { printf 'Requires x86_64 Linux.\n' >&2; exit 1; }
[[ ! -e $base && ! -e /etc/systemd/system/speech-coach-ai.service ]]
if getent passwd speech-coach >/dev/null; then
  printf 'The speech-coach user already exists; inspect before proceeding.\n' >&2
  exit 1
fi
if ss -ltnH 'sport = :3004' | grep -q .; then
  printf 'Port 3004 is already in use.\n' >&2
  exit 1
fi
[[ -f $archive ]]

useradd --system --home-dir /var/lib/speech-coach-ai --shell /sbin/nologin speech-coach
install -d -m 755 "$base" "$base/releases"
install -d -o speech-coach -g speech-coach -m 700 /var/lib/speech-coach-ai
install -d -o speech-coach -g speech-coach -m 755 "$release"
tar --extract --gzip --file "$archive" --directory "$release" --no-same-owner
chown -R speech-coach:speech-coach "$release"

download=$(mktemp -d)
trap 'rm -rf "$download"' EXIT
curl --fail --location --retry 3 --connect-timeout 15 --max-time 300 \
  "https://nodejs.org/dist/v${node_version}/${node_archive}" -o "$download/$node_archive"
curl --fail --location --retry 3 --connect-timeout 15 --max-time 60 \
  "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" -o "$download/SHASUMS256.txt"
(
  cd "$download"
  grep "  ${node_archive}\$" SHASUMS256.txt | sha256sum --check --strict
)
tar -xJf "$download/$node_archive" -C "$base"
ln -s "node-v${node_version}-linux-x64" "$base/runtime"

# Limit this build separately from the unrelated services on the same machine.
systemd-run --unit=speech-coach-install --wait --pipe --collect \
  --uid=speech-coach --gid=speech-coach --property="WorkingDirectory=$release" \
  --property=MemoryMax=1200M --property=CPUQuota=60% --property=Nice=10 \
  --setenv="PATH=$base/runtime/bin:/usr/bin:/bin" \
  --setenv=HOME=/var/lib/speech-coach-ai --setenv=NEXT_TELEMETRY_DISABLED=1 \
  --setenv=NODE_OPTIONS=--max-old-space-size=768 \
  /bin/bash -c 'set -e; npm ci --no-audit --no-fund; npm run build'

ln -s "$release" "$base/current"
install -m 644 "$release/deploy/speech-coach-ai.service" /etc/systemd/system/speech-coach-ai.service
systemctl daemon-reload
systemctl enable --now speech-coach-ai.service
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:3004/ -o /dev/null; then
    printf 'Speech Coach ready on 127.0.0.1:3004 (not publicly exposed).\n'
    exit 0
  fi
  sleep 2
done
systemctl status speech-coach-ai.service --no-pager
exit 1
