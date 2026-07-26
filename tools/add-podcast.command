#!/usr/bin/env bash
#
# add-podcast.command — double-click launcher for add-episode.sh (macOS).
#
# Double-click in Finder → a dialog asks for the episode URL → it runs the
# pipeline → the resulting R2 link is copied to your clipboard, ready to paste
# into Shadowloop's Load box. No Terminal typing needed.
#
# (Tip: right-click → Make Alias, drag the alias to the Desktop or Dock.)

cd "$(dirname "$0")" || exit 1

# Ask for the URL with a native dialog. Building the AppleScript from -e lines
# (and passing text as argv) avoids quoting pitfalls and the bash-3.2 heredoc
# bug — the message/answer never get interpolated into the script source.
url="$(osascript \
  -e 'on run argv' \
  -e 'try' \
  -e 'return text returned of (display dialog (item 1 of argv) default answer "" with title "加入 podcast" buttons {"取消", "加入"} default button "加入")' \
  -e 'on error' \
  -e 'return ""' \
  -e 'end try' \
  -e 'end run' \
  "貼上 podcast 集數網址：")"

# Trim whitespace; bail out on Cancel / empty.
url="$(printf '%s' "$url" | tr -d '[:space:]')"
[ -z "$url" ] && exit 0

note() {  # note <title> <message>
  osascript \
    -e 'on run argv' \
    -e 'display dialog (item 2 of argv) with title (item 1 of argv) buttons {"好"} default button "好"' \
    -e 'end run' \
    "$1" "$2" >/dev/null 2>&1
}

out="$(./add-episode.sh "$url" 2>&1)"; status=$?
r2url="$(printf '%s\n' "$out" | grep -oE 'https?://[^[:space:]]+\.mp3' | tail -1)"

if [ "$status" -eq 0 ] && [ -n "$r2url" ]; then
  printf '%s' "$r2url" | pbcopy
  note "完成 ✓（網址已複製到剪貼簿）" "$r2url

切回 Shadowloop，在 Load 框貼上即可。"
else
  note "沒成功" "$(printf '%s' "$out" | tail -c 500)"
fi
