#!/bin/bash
# Download official Supabase Auth (GoTrue) darwin-arm64 binary into .tools/gotrue (gitignored).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/.tools/gotrue"
VER="${GOTRUE_VERSION:-v2.198.0}"
URL="https://github.com/supabase/auth/releases/download/${VER}/auth-${VER#v}-darwin-arm64.tar.gz"
mkdir -p "$DEST"
if [[ -x "$DEST/auth" ]]; then
  echo "already present: $DEST/auth"
  exit 0
fi
TMP="$(mktemp)"
curl -fsSL -o "$TMP" "$URL"
tar -xzf "$TMP" -C "$DEST"
rm -f "$TMP"
chmod +x "$DEST/auth"
echo "installed $DEST/auth ($VER)"
