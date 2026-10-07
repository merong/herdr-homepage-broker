#!/usr/bin/env bash
# Turn one generated clip into a silent, seamless web loop: MP4 (H.264) + WebM (VP9) + poster.
# Usage: hero_video.sh <source_video> <out_dir> <asset_id> [width]   (width default 1600)
# Env: MP4_CRF (default 24), WEBM_CRF (default 36), XFADE (seconds, default 1; 0 = no loop blend).
# Clips of 4 s or longer get their last XFADE seconds blended into the first XFADE seconds,
# so the output is XFADE seconds shorter and its last frame flows into its first.
# Prints one tab-separated line per file: path, bytes, sha256. Warns above 4 MB (target), 6 MB (cap).
set -euo pipefail
if [ "$#" -lt 3 ]; then
  echo "usage: hero_video.sh <source_video> <out_dir> <asset_id> [width]" >&2
  exit 2
fi
src=$1 out=$2 id=$3 w=${4:-1600}
for tool in ffmpeg ffprobe shasum; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 2; }
done
[ -f "$src" ] || { echo "missing source: $src" >&2; exit 2; }
mkdir -p "$out"
tmp=$(mktemp -d)
trap '[ -n "${tmp:-}" ] && rm -rf -- "$tmp"' EXIT
d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src")
x=${XFADE:-1}
blend=$(awk -v d="$d" -v x="$x" 'BEGIN { print (x > 0 && d >= 4) ? 1 : 0 }')
if [ "$blend" = 1 ]; then
  off=$(awk -v d="$d" -v x="$x" 'BEGIN { printf "%.3f", d - 2 * x }')
  fc="[0:v]split[a][b];[a]trim=start=$x,setpts=PTS-STARTPTS[m];[b]trim=0:$x,setpts=PTS-STARTPTS[h];[m][h]xfade=transition=fade:duration=$x:offset=$off,scale=$w:-2,format=yuv420p[v]"
else
  fc="[0:v]scale=$w:-2,format=yuv420p[v]"
fi
ffmpeg -hide_banner -loglevel error -y -i "$src" -filter_complex "$fc" -map "[v]" -an \
  -c:v libx264 -crf 12 -preset slow "$tmp/master.mp4"
ffmpeg -hide_banner -loglevel error -y -i "$tmp/master.mp4" -an -c:v libx264 -preset slow \
  -crf "${MP4_CRF:-24}" -profile:v high -pix_fmt yuv420p -movflags +faststart "$out/$id-$w.mp4"
ffmpeg -hide_banner -loglevel error -y -i "$tmp/master.mp4" -an -c:v libvpx-vp9 -b:v 0 \
  -crf "${WEBM_CRF:-36}" -row-mt 1 -deadline good -cpu-used 2 "$out/$id-$w.webm"
ffmpeg -hide_banner -loglevel error -y -i "$out/$id-$w.mp4" -frames:v 1 -q:v 2 "$out/$id-poster.jpg"
for f in "$out/$id-$w.mp4" "$out/$id-$w.webm" "$out/$id-poster.jpg"; do
  bytes=$(wc -c <"$f" | tr -d ' ')
  printf '%s\t%s\t%s\n' "$f" "$bytes" "$(shasum -a 256 "$f" | cut -d' ' -f1)"
  case "$f" in
    *.mp4|*.webm)
      if [ "$bytes" -gt 6291456 ]; then echo "over 6 MB cap: $f (raise MP4_CRF/WEBM_CRF or lower width)" >&2
      elif [ "$bytes" -gt 4194304 ]; then echo "over 4 MB target: $f" >&2; fi ;;
  esac
done
echo "duration_in=$d blended=$blend width=$w" >&2
