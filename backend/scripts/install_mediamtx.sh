#!/usr/bin/env bash
# Installs the MediaMTX media server used for live NVR ingest and WebRTC into
# backend/bin/mediamtx (Linux x86_64). Air-gapped hosts: copy the release
# tarball next to this script and pass its path as the first argument.
set -euo pipefail
VERSION="${MEDIAMTX_VERSION:-v1.21.1}"
SHA256="653abc672a3e693f8d3b2717752492fdcfb8072291ec108d03d3dd857411b0ee"   # mediamtx_v1.21.1_linux_amd64.tar.gz
DEST="$(cd "$(dirname "$0")/.." && pwd)/bin"
TARBALL="${1:-}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
if [ -z "$TARBALL" ]; then
  TARBALL="$tmp/mediamtx.tar.gz"
  curl -fsSL -o "$TARBALL" "https://github.com/bluenviron/mediamtx/releases/download/${VERSION}/mediamtx_${VERSION}_linux_amd64.tar.gz"
fi
if [ "$VERSION" = "v1.21.1" ]; then
  echo "${SHA256}  ${TARBALL}" | sha256sum -c -
fi
tar -xzf "$TARBALL" -C "$tmp" mediamtx LICENSE
mkdir -p "$DEST"
install -m 0755 "$tmp/mediamtx" "$DEST/mediamtx"
install -m 0644 "$tmp/LICENSE" "$DEST/MEDIAMTX_LICENSE"
"$DEST/mediamtx" --version
