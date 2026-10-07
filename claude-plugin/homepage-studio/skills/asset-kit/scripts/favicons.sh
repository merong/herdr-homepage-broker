#!/usr/bin/env bash
# Build the favicon set from one square SVG mark.
# Usage: favicons.sh <mark.svg> <out_dir> <background_hex>
# Writes favicon.svg (copy), favicon.ico (16/32/48), apple-touch-icon.png (180, opaque),
# icon-192.png, icon-512.png (transparent) and icon-maskable-512.png (opaque, mark at 80%).
# Prints one tab-separated line per file: path, bytes, sha256.
set -euo pipefail
if [ "$#" -ne 3 ]; then
  echo "usage: favicons.sh <mark.svg> <out_dir> <background_hex>" >&2
  exit 2
fi
svg=$1 out=$2 bg=$3
for tool in rsvg-convert magick shasum; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 2; }
done
[ -f "$svg" ] || { echo "missing svg: $svg" >&2; exit 2; }
case "$bg" in \#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]) ;; *)
  echo "background must be #RRGGBB" >&2; exit 2 ;; esac
mkdir -p "$out"
tmp=$(mktemp -d)
trap '[ -n "${tmp:-}" ] && rm -rf -- "$tmp"' EXIT
png() { rsvg-convert -w "$1" -h "$1" -a "$svg" -o "$2"; }
on_bg() { # size, mark size, output
  png "$2" "$tmp/m.png"
  magick -size "$1x$1" "xc:$bg" "$tmp/m.png" -gravity center -composite -depth 8 -strip "$3"
}
cp "$svg" "$out/favicon.svg"
for s in 16 32 48; do png "$s" "$tmp/f$s.png"; done
magick "$tmp/f16.png" "$tmp/f32.png" "$tmp/f48.png" "$out/favicon.ico"
on_bg 180 148 "$out/apple-touch-icon.png"
png 192 "$tmp/i192.png" && magick "$tmp/i192.png" -depth 8 -strip "$out/icon-192.png"
png 512 "$tmp/i512.png" && magick "$tmp/i512.png" -depth 8 -strip "$out/icon-512.png"
on_bg 512 410 "$out/icon-maskable-512.png"
for f in favicon.svg favicon.ico apple-touch-icon.png icon-192.png icon-512.png icon-maskable-512.png; do
  printf '%s\t%s\t%s\n' "$out/$f" "$(wc -c <"$out/$f" | tr -d ' ')" "$(shasum -a 256 "$out/$f" | cut -d' ' -f1)"
done
