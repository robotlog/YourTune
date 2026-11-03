#!/bin/sh
# Builds the extension zip like `gnome-extensions pack`, without GNOME Shell:
# every file except the docs, tests and tools. GNOME 45+ compiles the schema
# on install, and extensions.gnome.org rejects a shipped gschemas.compiled.
# Usage: pack.sh <out.zip>
set -eu

out=$(realpath -m "$1")
mkdir -p "$(dirname "$out")"
src=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cp -r "$src/." "$tmp"
rm -rf "$tmp/README.md" "$tmp/tests" "$tmp/tools" "$tmp/.gitignore" \
  "$tmp/schemas/gschemas.compiled" "$tmp"/*.shell-extension.zip

rm -f "$out"
(cd "$tmp" && zip -qr "$out" .)
echo "$out"
