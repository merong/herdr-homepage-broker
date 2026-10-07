#!/usr/bin/env bash
# One labelled contact sheet of every image in the given directories (non-recursive).
# Usage: contact_sheet.sh <out.jpg> <dir> [<dir> ...]
# Picks up png, jpg, jpeg, webp, avif; svg files are rendered at 96 px first.
# Subdirectories (for example src/rejected/) are not read, so rejects stay out.
set -euo pipefail
if [ "$#" -lt 2 ]; then
  echo "usage: contact_sheet.sh <out.jpg> <dir> [<dir> ...]" >&2
  exit 2
fi
out=$1
shift
tmp=$(mktemp -d)
trap '[ -n "${tmp:-}" ] && rm -rf -- "$tmp"' EXIT
list=()
for dir in "$@"; do
  [ -d "$dir" ] || { echo "skip missing dir: $dir" >&2; continue; }
  while IFS= read -r f; do
    case "$f" in
      *.svg|*.SVG)
        png="$tmp/$(basename "$f" .svg).png"
        rsvg-convert -w 96 -h 96 -a "$f" -o "$png"
        list+=("$png") ;;
      *) list+=("$f") ;;
    esac
  done < <(find "$dir" -maxdepth 1 -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \
             -o -iname '*.webp' -o -iname '*.avif' -o -iname '*.svg' \) | sort)
done
if [ "${#list[@]}" -eq 0 ]; then
  echo "no images found" >&2
  exit 2
fi
magick montage -label '%t' "${list[@]}" -tile 4x -geometry 480x270+8+8 \
  -background '#1a1a1a' -fill '#dddddd' -pointsize 14 "$out"
echo "$out: ${#list[@]} images"
