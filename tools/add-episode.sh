#!/usr/bin/env bash
#
# add-episode.sh <episode page URL> — one command, one pasteable URL.
#
# Downloads an episode's audio + cover, converts the audio to CBR mono (fast
# seeking, small file), uploads BOTH to your Cloudflare R2 bucket under a
# matching filename, and prints the URL to paste into Shadowloop. Because the
# cover sits next to the audio with the same name, Shadowloop picks it up
# automatically — you only paste the one mp3 URL.
#
# ── One-time setup ──────────────────────────────────────────────────────
#   brew install yt-dlp rclone           # ffmpeg you already have
#   rclone config                        # make an "s3" remote → Cloudflare R2
#                                        # (needs your R2 Access Key / Secret)
#   Then fill in the CONFIG block below, and in the Cloudflare dashboard turn
#   on the bucket's Public access (r2.dev) so the URLs are readable.
#
# ── Usage ───────────────────────────────────────────────────────────────
#   tools/add-episode.sh https://www.npr.org/2026/07/20/nx-s1-.../some-episode
#
# Heads-up: yt-dlp can't grab every site; if a given episode fails to
# download, fall back to the manual route (download by hand → mp3-for-dropbox.sh).

set -euo pipefail

# ── CONFIG — fill these in after setup ──────────────────────────────────
REMOTE="r2"                              # rclone remote name (from `rclone config`)
BUCKET="shadowloop"                      # your R2 bucket name
PUBLIC_BASE="https://pub-XXXXXXXX.r2.dev" # bucket public base URL, no trailing slash
BITRATE="64k"                            # audio bitrate (96k/128k for more fidelity)
# ────────────────────────────────────────────────────────────────────────

url="${1:-}"
if [ -z "$url" ]; then
  echo "usage: add-episode.sh <episode page URL>" >&2
  exit 1
fi
if [[ "$PUBLIC_BASE" == *XXXX* ]]; then
  echo "Fill in the CONFIG block first (REMOTE / BUCKET / PUBLIC_BASE)." >&2
  exit 1
fi
for bin in yt-dlp ffmpeg rclone; do
  command -v "$bin" >/dev/null 2>&1 || { echo "missing: $bin  (brew install $bin)" >&2; exit 1; }
done

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

echo "→ downloading audio + cover…"
# --restrict-filenames -> ascii, spaces become underscores: clean URLs, and
# Shadowloop turns those underscores back into spaces for a tidy title.
yt-dlp -x --audio-format mp3 \
  --write-thumbnail --convert-thumbnails jpg \
  --restrict-filenames \
  -o "$work/%(title)s.%(ext)s" \
  "$url"

mp3src="$(find "$work" -maxdepth 1 -iname '*.mp3' | head -1)"
img="$(find "$work" -maxdepth 1 -iname '*.jpg' | head -1)"
[ -n "$mp3src" ] || { echo "no audio was downloaded — try the manual route" >&2; exit 1; }

stem="$(basename "${mp3src%.*}")"
echo "→ converting to CBR ${BITRATE} mono…"
cbr="$work/${stem}.cbr.mp3"
ffmpeg -loglevel error -y -i "$mp3src" \
  -c:a libmp3lame -b:a "$BITRATE" -ac 1 -map_metadata 0 -id3v2_version 3 "$cbr"

echo "→ uploading to R2 (${REMOTE}:${BUCKET})…"
# --s3-no-check-bucket: R2 object tokens can't CreateBucket, and rclone's
# pre-upload existence check would 403 without it (the bucket already exists).
rclone copyto --s3-no-check-bucket "$cbr" "${REMOTE}:${BUCKET}/${stem}.mp3"
[ -n "$img" ] && rclone copyto --s3-no-check-bucket "$img" "${REMOTE}:${BUCKET}/${stem}.jpg"

echo
echo "Done ✓  Paste this into Shadowloop (cover loads automatically):"
echo "  ${PUBLIC_BASE}/${stem}.mp3"
