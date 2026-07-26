# Cloudflare R2 設定（給自動化上傳用）

目標：把 podcast 音檔 + 封面放到一個**固定、可 seek、跨裝置**的網址，之後用
`tools/add-episode.sh` 一行指令自動下載→轉檔→上傳→印出網址，貼進 Shadowloop 就好。

第一次設定約 15 分鐘，**只做一次**。之後每一集只要跑一行指令。

---

## 一、註冊 Cloudflare 並開啟 R2

1. 到 <https://dash.cloudflare.com/sign-up> 註冊一個免費帳號（用 email 即可）。
2. 登入後，左邊選單找到 **R2**（或 **R2 Object Storage**），點進去。
3. 第一次會要你 **綁一張信用卡**才能啟用 R2。
   - ⚠️ 這是 Cloudflare 的規定，**綁卡不等於收費**。R2 有免費額度（每月 10GB 儲存、A/B class 操作各數百萬次），你放幾十集 podcast 遠遠用不完，實際上是 **$0**。
4. 按下啟用 R2。

## 二、建立一個 Bucket（放檔案的空間）

1. 在 R2 頁面按 **Create bucket**。
2. 名字打 `shadowloop`（全小寫、不要空格）。地區選預設（Automatic）即可。
3. 按 **Create bucket** 完成。

## 三、開啟公開存取（Public Development URL）

預設 bucket 是私密的，要開公開網址 app 才讀得到。

1. 點進你剛建的 `shadowloop` bucket → 上方分頁 **Settings**。
2. 找到 **Public Development URL**（或寫 **R2.dev subdomain**）→ 按 **Enable**。
3. 會跳出警告說「這會讓 bucket 內容公開」，按確認（**Allow**）。
4. 它給你一個網址，長得像：
   ```
   https://pub-abc123def456.r2.dev
   ```
   **把這個網址記下來**，等一下填進腳本的 `PUBLIC_BASE`。
   - 你上傳的 `foo.mp3` 之後就會在 `https://pub-abc123def456.r2.dev/foo.mp3`。

## 四、建立 API 金鑰（給 rclone 上傳用）

1. 回到 R2 主頁（左邊選單 R2）→ 右上角或側邊找 **Manage R2 API Tokens**
   （有時寫 **API Tokens** / **管理 R2 API 權杖**）。
2. 按 **Create API token**。
3. 權限（Permissions）選 **Object Read & Write**。
4. TTL / 到期時間選 **Forever**（或最長），按建立。
5. 建立後畫面會顯示三樣東西，**這一頁關掉就看不到了，先全部複製存好**：
   - **Access Key ID**（一串英數）
   - **Secret Access Key**（更長一串）
   - **S3 endpoint / Endpoint**，長得像
     `https://<你的帳號ID>.r2.cloudflarestorage.com`
     — 這個 endpoint 等一下 rclone 要用。

---

## 五、安裝並設定 rclone

rclone 是負責把檔案上傳到 R2 的工具。

**1. 安裝**（ffmpeg 你已經有了）
```
brew install yt-dlp rclone
```

**2. 執行設定精靈**
```auto
rclone config
```
它會一問一答，照下面回答（**括號是說明，不用打**）：

```
n                → New remote（新增）
name> r2         （remote 名字，就叫 r2）
Storage> s3      （在清單裡找 "Amazon S3 Compliant..."，輸入 s3 或它的編號）
provider>        （找 "Cloudflare R2"，輸入 Cloudflare 或它的編號）
env_auth>        （直接按 Enter，用預設 false）
access_key_id>   （貼上第四步的 Access Key ID）
secret_access_key> （貼上第四步的 Secret Access Key）
region>          （輸入 auto）
endpoint>        （貼上第四步的 S3 endpoint，
                  https://<帳號ID>.r2.cloudflarestorage.com）
location_constraint> （直接 Enter 跳過）
acl>             （直接 Enter 跳過）
Edit advanced config?  n
Keep this "r2" remote?  y
```
最後選 **q** 離開設定精靈。

**3. 讓 rclone 別嘗試建立 bucket**（R2 必做，否則上傳會 403）
```
rclone config update r2 no_check_bucket true
```
> R2 的 API token 沒有「建立 bucket」的權限，而 rclone 上傳前預設會先檢查／嘗試建立
> bucket，導致 `AccessDenied`。這行讓它跳過該檢查（bucket 你已經建好了）。

**4. 測試連線**（列出 bucket 內容，空的話沒輸出＝正常）
```
rclone ls r2:shadowloop
```
> 註：不要用 `rclone lsd r2:`（列出「所有」bucket），那是帳號層級操作，R2 token
> 通常沒權限、會回 403 —— 那是正常的，不代表設定錯。直接測 `r2:shadowloop` 才準。

**5. 往返測試**（確認真的能上傳、能刪）
```
printf 'ok\n' > /tmp/_r2test.txt
rclone copyto /tmp/_r2test.txt r2:shadowloop/_r2test.txt   # 應顯示無錯誤
rclone ls r2:shadowloop                                    # 應看到 _r2test.txt
rclone delete r2:shadowloop/_r2test.txt                    # 清掉
```

---

## 六、填腳本設定

打開 `tools/add-episode.sh`，把最上面 CONFIG 三行改成你的值：

```bash
REMOTE="r2"                                  # rclone 那個 remote 名字
BUCKET="shadowloop"                          # 你的 bucket 名字
PUBLIC_BASE="https://pub-abc123def456.r2.dev" # 第三步記下的公開網址（結尾不要斜線）
```

---

## 七、開始用

```
tools/add-episode.sh <NPR 或其他 podcast 集數網址>
```

它會：下載音檔+封面 → 轉 CBR → 上傳 R2 → **印出一個網址**。
把那個網址貼進 Shadowloop（封面會自動載入），就能開始標 clip 練習。

---

## 常見問題

- **綁卡會被扣錢嗎？** 正常個人用量在免費額度內，是 $0。Cloudflare 只是要卡在檔。
- **r2.dev 網址有限制嗎？** 有速率限制，個人跟讀練習完全夠；日後要大量再綁自訂網域。
- **公開網址安全嗎？** 等同「知道連結就能存取」，網址不好猜，別主動公開分享 bucket 即可。
- **某一集下載失敗？** yt-dlp 不是每個站都支援；那集就退回手動流程（自己下載 → `tools/mp3-for-dropbox.sh` → 手動上傳 R2）。
- **endpoint 忘了記？** 在 R2 API Tokens 頁面重建一組 token 即可再看到。
