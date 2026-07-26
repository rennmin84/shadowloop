# CLAUDE.md — Shadowloop

Shadowloop 是 Eric 的英文 shadowing（跟讀）練習 PWA：載入 YouTube 影片或 podcast 音檔，標記一小段 clip，反覆 replay 跟讀並累積每日次數。

## 技術架構

- **純前端 vanilla JS，沒有 build step**。直接編輯檔案即是最終產物。
  - [index.html](index.html) — 全部畫面（Home / Practice / Clips 三個 view）
  - [app.js](app.js) — 所有邏輯（~2200 行，單檔）
  - [style.css](style.css)、[sw.js](sw.js)、[manifest.json](manifest.json)
- **儲存**：`localStorage` 存 clips / logs / settings；`IndexedDB`（DB 名 `shadowloop`）存每個 clip 最新一次的錄音 take。
- **後端（選用）**：[apps-script/Code.gs](apps-script/Code.gs) 是 Google Apps Script Web App，兼兩職：
  1. 雲端同步 — 把整份 JSON 快照存進名為 `shadowloop_data` 的 Sheet（分段存，單格上限 5 萬字）。
  2. Podcast metadata proxy — `?meta=<page url>`，伺服器端抓 og/twitter tag，並用 Apple Podcasts index 繞過 NPR 等 bot 牆。
- **部署**：GitHub Pages，remote 是 `rennmin84/shadowloop`。**push 到 `main` 即上線**。
- `sw.js` 是 **network-first**（2026-07-20 改），改資源不用再 bump CACHE 版本，線上端一律抓最新。

## Podcast 音源的穩定性（重要背景）

Podcast 的 mp3 網址大多是**動態廣告插入（DAI）**的轉址：每次請求重拼一組廣告，片頭/中插長度都會變，所以**同一個網址、同一段內容的絕對時間會漂移**——今天存的 clip，下週打開可能差好幾秒（且每個 clip 差的量不同，因為中插廣告各段變化不同）。VBR mp3 的 seek 估算誤差會再疊加。

因此「認真要重複練的 podcast clip」的正解是**凍結位元組**：下載成自己的固定檔、放到穩定網址。相關工具：

- [tools/mp3-for-dropbox.sh](tools/mp3-for-dropbox.sh) — 把 mp3 批次轉成 **64k 單聲道 CBR**（seek 幾乎即時、檔案縮 ~4×）。
- [tools/add-episode.sh](tools/add-episode.sh) — 一行全自動：用 **Apple Podcasts 索引**（同 Code.gs 的做法）解析出標題/音檔/封面 → 下載 → CBR → 上傳 **Cloudflare R2** → 印出一個貼進 app 的網址。實作細節：網路請求走 `curl`（Homebrew Python 無法驗 TLS）；resolver 寫到暫存檔再呼叫（macOS bash 3.2 無法解析 `$()` 內的 heredoc）；rclone 需 `no_check_bucket=true`（R2 token 不能 CreateBucket）。
- [R2-SETUP.md](R2-SETUP.md) — R2 + rclone 一次性設定教學。

App 端配套：直連音檔的**標題自動用檔名帶入**（底線→空格）；若旁邊有**同名圖檔**（`ep.mp3`+`ep.jpg`）會自動抓成封面（`autoCoverFrom`，路徑式主機才有用，Dropbox 亂碼連結無效）；載入/seek 期間顯示 Loading 徽章並把 Replay 鎖住到可播（`setAudioBusy`）。貼 Dropbox/Drive 分享連結會自動轉直連（`directShareUrl`）。

## 開發慣例

- **直接 commit + push 到 `main`**，不開分支、不用問。commit 訊息尾端加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 用繁體中文回覆；先給評估/批判，再實作。

## 測試（沒有測試框架）

冒煙測試流程：
```bash
python3 -m http.server 8000   # 在專案根目錄
# 另一個 shell：
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --virtual-time-budget=4000 --dump-dom \
  http://localhost:8000/ 2>err.log
```
然後檢查 dump 出的 DOM 與 `err.log` 有無 JS 例外。

⚠️ `node --check app.js` **抓不到 TDZ / 執行期 crash**（例如 `const` 在宣告前被用到）。改完務必實際跑起來確認 app 有初始化，不能只靠語法檢查。

備註：app.js 裡 top-level `function` 宣告會掛到 window 全域；`let/const` 狀態則不會。

## 鍵盤快捷鍵（Studio 分頁，內部 view id 仍是 `view-practice`）

- `S` play/pause、`Space`/`R`/`Enter` replay
- `A`/`D` 前後移動 start（含播放中；`Shift` = 10 秒）
- `J`/`L` 縮放 clip 長度、`ArrowLeft`/`Right` 微調 start
- `Cmd/Ctrl+Enter` 開存檔視窗（視窗內再按一次 = 存檔）
- 快捷鍵以 `e.code`（實體鍵）判定，中文輸入法開著也能用。
