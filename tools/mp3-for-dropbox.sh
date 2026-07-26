#!/usr/bin/env bash
#
# mp3-for-dropbox.sh — prep podcast MP3s for Shadowloop + Dropbox.
#
# Re-encodes each MP3 to constant-bitrate (CBR) 64k mono, which:
#   • makes seeking to a timestamp near-instant (VBR files stall on seek), and
#   • shrinks a typical episode from ~30–50MB down to ~10MB.
#
# Usage:
#   ./mp3-for-dropbox.sh                  # convert every .mp3 in the current folder
#   ./mp3-for-dropbox.sh a.mp3 b.mp3      # convert specific files
#   ./mp3-for-dropbox.sh /path/to/folder  # convert every .mp3 in that folder
#
# Converted files land in ./dropbox-ready/ (your originals are left untouched).
# Upload those to Dropbox → share as "Anyone with the link" → paste into Shadowloop.

set -euo pipefail

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Install it once with:  brew install ffmpeg" >&2
  exit 1
fi

BITRATE="64k"        # plenty for speech; bump to 96k/128k for more fidelity
OUTDIR="dropbox-ready"

# Default to the current folder when no argument is given.
if [ "$#" -eq 0 ]; then set -- .; fi

# Collect input files from the arguments (files and/or folders).
inputs=()
for arg in "$@"; do
  if [ -d "$arg" ]; then
    while IFS= read -r -d '' f; do inputs+=("$f"); done \
      < <(find "$arg" -maxdepth 1 -type f -iname '*.mp3' -print0)
  elif [ -f "$arg" ]; then
    inputs+=("$arg")
  else
    echo "Skipping (not found): $arg" >&2
  fi
done

if [ "${#inputs[@]}" -eq 0 ]; then
  echo "No .mp3 files to convert." >&2
  exit 1
fi

mkdir -p "$OUTDIR"
count=0
for f in "${inputs[@]}"; do
  out="$OUTDIR/$(basename "$f")"
  if [ -e "$out" ]; then
    echo "• already done, skipping: $(basename "$f")"
    continue
  fi
  echo "→ converting: $(basename "$f")"
  ffmpeg -loglevel error -y -i "$f" \
    -c:a libmp3lame -b:a "$BITRATE" -ac 1 -map_metadata 0 -id3v2_version 3 \
    "$out"
  count=$((count + 1))
done

echo
echo "Done. $count file(s) ready in ./$OUTDIR/"
echo "Upload those to Dropbox → share \"Anyone with the link\" → paste into Shadowloop."
