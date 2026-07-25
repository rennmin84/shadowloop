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
