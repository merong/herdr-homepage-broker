#!/usr/bin/env bash
# Make AVIF + WebP web derivatives of one source image.
# Usage: make_web.sh <source> <out_dir> <asset_id> <width> [<width> ...]
# Env: AVIF_Q (default 60), WEBP_Q (default 78).
# Never upscales: widths larger than the source are skipped and reported.
# Prints one tab-separated line per file: path, width, height, bytes, sha256.
set -euo pipefail
if [ "$#" -lt 4 ]; then
  echo "usage: make_web.sh <source> <out_dir> <asset_id> <width> [<width> ...]" >&2
  exit 2
fi
src=$1 out=$2 id=$3
shift 3
for tool in magick avifenc cwebp shasum; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 2; }
done
[ -f "$src" ] || { echo "missing source: $src" >&2; exit 2; }
mkdir -p "$out"
sw=$(magick identify -format '%w' "$src[0]")
tmp=$(mktemp -d)
trap '[ -n "${tmp:-}" ] && rm -rf -- "$tmp"' EXIT
for w in "$@"; do
  if [ "$w" -gt "$sw" ]; then
    echo "skip $id-$w: source is ${sw}px wide" >&2
    continue
  fi
  magick "$src[0]" -resize "${w}x" -strip -colorspace sRGB -depth 8 "$tmp/$w.png"
  avifenc -q "${AVIF_Q:-60}" -s 6 -d 8 -y 420 "$tmp/$w.png" "$out/$id-$w.avif" >/dev/null
  cwebp -quiet -q "${WEBP_Q:-78}" -m 6 "$tmp/$w.png" -o "$out/$id-$w.webp"
  for f in "$out/$id-$w.avif" "$out/$id-$w.webp"; do
    dims=$(magick identify -format '%w %h' "$f" | tr ' ' '\t')
    bytes=$(wc -c <"$f" | tr -d ' ')
    sum=$(shasum -a 256 "$f" | cut -d' ' -f1)
    printf '%s\t%s\t%s\t%s\n' "$f" "$dims" "$bytes" "$sum"
  done
done
