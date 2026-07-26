#!/usr/bin/env bash
#
# add-episode.sh <episode page URL> — one command, one pasteable URL.
#
# Resolves a podcast episode page to its audio + cover (via the Apple Podcasts
# index, the same trick Shadowloop's proxy uses — falling back to scraping the
# page), converts the audio to CBR mono (fast seeking, small file), uploads
# BOTH to your Cloudflare R2 bucket under a matching filename, and prints the
# URL to paste into Shadowloop. The cover sits next to the audio with the same
# name, so Shadowloop picks it up automatically — you only paste the mp3 URL.
#
# ── One-time setup ──────────────────────────────────────────────────────
#   brew install rclone                  # ffmpeg + python3 you already have
#   rclone config                        # make an "s3" remote → Cloudflare R2
#   rclone config update r2 no_check_bucket true
#   Then fill in the CONFIG block below, and turn on the bucket's Public
#   access (r2.dev) in the Cloudflare dashboard. See R2-SETUP.md.
#
# ── Usage ───────────────────────────────────────────────────────────────
#   tools/add-episode.sh https://www.npr.org/2026/07/20/nx-s1-.../some-episode
#
# Heads-up: some episodes won't resolve (odd hosts, private feeds); if one
# fails, fall back to the manual route (download by hand → mp3-for-dropbox.sh).

set -euo pipefail

# ── CONFIG — fill these in after setup ──────────────────────────────────
REMOTE="r2"                              # rclone remote name (from `rclone config`)
BUCKET="shadowloop"                      # your R2 bucket name
PUBLIC_BASE="https://pub-c881f4f6508f4bb893d854aa6f3194e5.r2.dev" # bucket public base URL, no trailing slash
BITRATE="64k"                            # audio bitrate (96k/128k for more fidelity)
# ────────────────────────────────────────────────────────────────────────

UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"

url="${1:-}"
if [ -z "$url" ]; then
  echo "usage: add-episode.sh <episode page URL>" >&2
  exit 1
fi
if [[ "$PUBLIC_BASE" == *XXXX* ]]; then
  echo "Fill in the CONFIG block first (REMOTE / BUCKET / PUBLIC_BASE)." >&2
  exit 1
fi
for bin in ffmpeg rclone python3 curl; do
  command -v "$bin" >/dev/null 2>&1 || { echo "missing: $bin" >&2; exit 1; }
done

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

echo "→ resolving episode (Apple Podcasts index)…"
# The resolver prints four lines: TITLE / AUDIO_URL / COVER_URL / SLUG.
# (Written to a temp file rather than a heredoc inside $(), which macOS's
#  bundled bash 3.2 mis-parses.)
cat > "$work/resolve.py" <<'PY'
import sys, re, json, html, unicodedata, urllib.parse, subprocess
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"

# Fetch via curl (system CA store) — Homebrew Python often can't verify TLS.
def get(u, t=25):
    return subprocess.run(['curl', '-fsL', '--max-time', str(t), '-A', UA, u],
                          capture_output=True, check=True).stdout

def toks(s):
    return [w for w in re.sub(r'[^a-z0-9]+', ' ', s.lower()).split() if len(w) >= 2]

def slug_term(page):
    path = re.sub(r'[?#].*$', '', re.sub(r'^https?://[^/]+', '', page))
    best = ''
    for seg in path.split('/'):
        words = [w for w in re.split(r'[-_]+', urllib.parse.unquote(seg)) if w and not w.isdigit()]
        if len(words) >= 2 and len(words) > len(best.split()):
            best = ' '.join(words)
    return best.strip()

def overlap(want, got):
    if len(want) < 2: return False
    s = set(got); hit = sum(1 for w in want if w in s)
    return hit >= 2 and hit / len(want) >= 0.6

def itunes(term):
    try:
        u = 'https://itunes.apple.com/search?media=podcast&entity=podcastEpisode&limit=5&term=' + urllib.parse.quote(term)
        data = json.loads(get(u))
        want = toks(term)
        for r in data.get('results', []):
            if overlap(want, toks(r.get('trackName', ''))):
                return (r.get('trackName', '').strip(),
                        r.get('episodeUrl', '') or '',
                        r.get('artworkUrl600') or r.get('artworkUrl100') or '')
    except Exception:
        pass
    return None

def meta_tag(h, prop):
    p = re.escape(prop)
    m = re.search(r'<meta[^>]+(?:property|name)\s*=\s*["\']' + p + r'["\'][^>]*?content\s*=\s*["\']([^"\']*)["\']', h, re.I) \
        or re.search(r'<meta[^>]+content\s*=\s*["\']([^"\']*)["\'][^>]*?(?:property|name)\s*=\s*["\']' + p + r'["\']', h, re.I)
    return html.unescape(m.group(1)) if m else ''

def scrape(page):
    try:
        h = get(page).decode('utf-8', 'replace')
    except Exception:
        return None
    audio = meta_tag(h, 'og:audio:secure_url') or meta_tag(h, 'og:audio')
    if not audio:
        m = re.search(r'https?://[^"\'\s<>]+\.mp3[^"\'\s<>]*', h, re.I)
        audio = html.unescape(m.group(0)) if m else ''
    return (meta_tag(h, 'og:title').strip(), audio, meta_tag(h, 'og:image'))

def slugify(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^A-Za-z0-9]+', '_', s).strip('_') or 'episode'

page = sys.argv[1]
res = itunes(slug_term(page))
if not res or not res[1]:
    sc = scrape(page)
    if sc:
        res = ((res[0] if res else '') or sc[0], (res[1] if res else '') or sc[1], (res[2] if res else '') or sc[2])
    if res and res[0] and not res[1]:      # have a title but no audio → ask Apple by title
        r2 = itunes(res[0])
        if r2: res = (res[0], r2[1], res[2] or r2[2])
if not res or not res[1]:
    sys.exit(1)
title, audio, cover = res
print(title)
print(audio)
print(cover or '')
print(slugify(title))
PY

set +e
meta="$(python3 "$work/resolve.py" "$url")"
rc=$?
set -e
[ $rc -eq 0 ] || { echo "Couldn't resolve that episode. Try the manual route (see R2-SETUP.md)." >&2; exit 1; }

title="$(printf '%s\n' "$meta" | sed -n '1p')"
audio="$(printf '%s\n' "$meta" | sed -n '2p')"
cover="$(printf '%s\n' "$meta" | sed -n '3p')"
stem="$(printf '%s\n' "$meta" | sed -n '4p')"
echo "   title: $title"

echo "→ downloading audio…"
curl -fsL --max-time 180 -A "$UA" -o "$work/src.mp3" "$audio" \
  || { echo "audio download failed" >&2; exit 1; }
if [ -n "$cover" ]; then
  echo "→ downloading cover…"
  curl -fsL --max-time 60 -A "$UA" -o "$work/cover.jpg" "$cover" || cover=""
fi

echo "→ converting to CBR ${BITRATE} mono…"
ffmpeg -loglevel error -y -i "$work/src.mp3" \
  -c:a libmp3lame -b:a "$BITRATE" -ac 1 -map_metadata 0 -id3v2_version 3 "$work/${stem}.mp3"

echo "→ uploading to R2 (${REMOTE}:${BUCKET})…"
# --s3-no-check-bucket: R2 object tokens can't CreateBucket, and rclone's
# pre-upload existence check would 403 without it (the bucket already exists).
rclone copyto --s3-no-check-bucket "$work/${stem}.mp3" "${REMOTE}:${BUCKET}/${stem}.mp3"
[ -n "$cover" ] && rclone copyto --s3-no-check-bucket "$work/cover.jpg" "${REMOTE}:${BUCKET}/${stem}.jpg"

echo
echo "Done ✓  Paste this into Shadowloop (cover loads automatically):"
echo "  ${PUBLIC_BASE}/${stem}.mp3"
