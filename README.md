# Shadowloop

英文 shadowing（跟讀）練習 PWA：載入 YouTube 影片或 podcast 音檔，標記一小段
clip，反覆 replay 跟讀並累積每日次數、連續天數與熱力圖。

純前端（vanilla JS，無 build step），部署在 GitHub Pages；選用 Google Apps Script
做跨裝置同步。開發／架構細節見 [CLAUDE.md](CLAUDE.md)。

---

## 加入練習素材

在 Home 或 Studio 的 **Load** 框貼一個連結。三種來源：

### 1. YouTube（最穩、最省事）
任何影片連結（`youtube.com/watch?v=…` 或 `youtu.be/…`）。時間軸固定，直接貼即可。

### 2. Podcast 集數網頁（快，但會漂移）
貼**集數頁面**的網址，標題／封面／音檔會自動帶入。適合一次性試聽——但 podcast 每次
請求會重塞廣告，**今天存的 clip 時間點下週可能差好幾秒**。要重複練的請用第 3 種。

### 3. 自己 host 的固定檔（穩定、跨裝置）★推薦
下載成自己的固定 mp3、放到穩定網址（Cloudflare R2），時間軸永遠不漂、電腦手機共用。
用 [`tools/add-episode.sh`](tools/add-episode.sh) 一行全自動完成。

---

## 自動加入一集 podcast（穩定流程）

**第一次設定（約 15 分鐘，只做一次）**：照 [R2-SETUP.md](R2-SETUP.md) 設好
Cloudflare R2 + rclone，並填好 [`tools/add-episode.sh`](tools/add-episode.sh) 最上面的
CONFIG（`REMOTE` / `BUCKET` / `PUBLIC_BASE`）。

**之後每一集**，在專案資料夾開終端機執行（注意前面的 `./`）：

```bash
./tools/add-episode.sh https://www.npr.org/…/episode-name
```

它會：用 Apple Podcasts 索引解析標題／音檔／封面 → 下載 → 轉成小而快的 CBR 檔 →
上傳 R2 → **印出一個網址**。把那個網址貼進 app 的 **Load**，標題和封面會自動帶入。

**隔天想再拿到網址**：

```bash
./tools/add-episode.sh --list          # 列出加過的每一集 + 網址
./tools/add-episode.sh <同一個連結>     # 偵測已在 R2，秒回同一網址（不重抓）
```

已經**存過 clip** 的那集，clip 本身就記著網址並會同步到手機——直接開 **Clips** 即可，
不用重貼。

---

## 工具

| 檔案 | 用途 |
|---|---|
| [`tools/add-episode.sh`](tools/add-episode.sh) | 一行下載＋轉檔＋上傳 R2＋印出網址；`--list` 看清單 |
| [`tools/mp3-for-dropbox.sh`](tools/mp3-for-dropbox.sh) | 把手動下載的 mp3 批次轉成 64k 單聲道 CBR |
| [R2-SETUP.md](R2-SETUP.md) | Cloudflare R2 + rclone 一次性設定 |
| [SYNC-SETUP.md](SYNC-SETUP.md) | 跨裝置同步（Google Apps Script + Sheets）設定 |

---

## 鍵盤快捷鍵（Studio）

`S` 播放/暫停 · `Space`/`R` replay · `A`/`D` 前後移動起點（含播放中，`Shift`＝10 秒） ·
`J`/`L` 縮放長度 · `←`/`→` 微調起點 · `Cmd/Ctrl+Enter` 開存檔視窗。
（以實體鍵判定，中文輸入法開著也能用。）
