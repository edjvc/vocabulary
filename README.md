# Ed Vocabulary 英文單字抽背

使用 iPhone Safari 即可開啟的個人英文單字 App。專案內已包含 Lexifold TOEIC 的完整 4,027 筆詞條。

## 發佈到 GitHub Pages

1. 登入 [GitHub](https://github.com/new)，建立公開的 repo，例如 `vocabulary`。
2. 解壓縮 ZIP。在 repo 選 **Add file → Upload files**，上傳解壓後的內容至 repo 根目錄。確認 `index.html`、`app.js`、`db.js`、`sw.js`、`manifest.webmanifest`、`style.css`、`assets/`、`data/` 都在根層，並提交到 `main`。若瀏覽器未選取隱藏檔案，通常仍可用 GitHub Pages 的預設建置發佈。
3. 在 **Settings → Pages → Build and deployment**，選 **Deploy from a branch**，選擇 **main** 與 **/(root)**，按 **Save**。在 Pages 設定頁確認發佈網址。
4. 在 iPhone Safari 開啟該網址，選 **分享 → 加入主畫面**。如有「以網頁 App 開啟」的選項，將它打開再按「加入」。

如果之前已上傳初版，請上傳這份版本的檔案並刪除舊的 `.github/workflows/deploy.yml`，再使用上面的分支設定。請在同一網址更新程式，以沿用該網址下的既有學習資料。

## 使用方式

- 所有單字一起隨機抽背，可依熟悉、僅發音不熟、不熟、陌生或未標記篩選。每輪洗牌，同輪內不重複。上一版的「不太熟」標記會顯示為「不熟」。
- 單字庫的「搜尋或新增」欄位可以搜尋現有詞條。輸入有效的英文拼法且字庫中沒有相同詞條時，欄位下方會顯示「新增」。點單字列的任何位置都會開啟詳細頁。
- 在抽背或詳細頁，點熟悉度狀態可開啟選單，設定等級或按「取消標記」回到未標記。關閉選單會保留原本的標記。
- 抽背時點「顯示答案」會打開完整詳細頁。「字根記憶」會顯示已整理的拆解、關鍵來源、助記與來源連結。
- 「Cambridge 查發音」和「字根記憶」標題右側的「查詞源」會把目前單字帶入各自的網站搜尋。在 iPhone 主畫面 App 中，外部連結交給系統的瀏覽視窗。從手機 Safari 使用時，連結在原分頁打開，按上一頁可回到查詢前的單字。兩個搜尋都需要網路。
- 瀏覽器透過 IndexedDB 自動保存個人資料。正常關閉再開啟會直接讀取；完成第一次載入及快取後，也可離線開啟。
- 備份在「設定」手動建立或載入 JSON 檔，檔案可自行存至 iPhone 或 iCloud Drive。還原前會詢問確認，還原只會取代個人紀錄。請把備份與 repo 的上傳資料分開保管。

- 核心 4,027 筆的繁中釋義可離線查看。額外內建的離線釋義會在符合自訂單字時顯示。
- 新增單字或首次開啟詳細資料時會向維基詞典查詢。連網後可補查離線加入的詞條。成功的結果保存在本機，也包含在 JSON 備份中。
- 英文例句以來源原文顯示。「字根記憶」顯示已整理的拆解、關鍵來源和助記。當資料已下載，即可離線查看。

## 逐批加入字根記憶

這版含已確認的 50 張試卡。其餘詞條可以分批整理，每批沿用試卡的 JSON 格式與 Lexifold 詞條 ID。從專案根目錄執行 `python3 scripts/merge_root_notes.py --next 100` 可列出下一批尚未整理的詞條。卡片整理好後，執行以下指令將新批次加入累積資料。

```bash
python3 scripts/merge_root_notes.py /path/to/root-notes-batch.json
git add data/root-notes.json
git commit -m "Add reviewed root notes"
git push origin main
```

匯入程式會核對原始詞條 ID、大小寫與來源欄位，保留原字表和個人資料。有意修訂既有試卡時可指定 `--replace`。執行 `python3 scripts/merge_root_notes.py` 即可單獨驗證目前累積資料和詞條數。

之後每批更新只需部署 `data/root-notes.json`。App 連網重開會檢查新版，離線時讀取已下載的版本。在「設定 → 核心字庫」可以查看已整理筆數。
- 若 ECDICT 沒有對應詞條，App 會使用維基詞典有提供的中文翻譯或釋義。線上查詢透過公開 API 傳送正在查詢的英文單字。

## 本機開發

在專案根目錄執行 `python3 -m http.server 8080`，從 `http://localhost:8080/` 開啟。瀏覽器會使用 `sw.js` 的版本號管理離線快取。若更新網站檔案，請同步更新 `sw.js` 的 `cacheName` 版本，讓瀏覽器重新快取。

`data/core.json` 已隨專案附上。原始資料的欄位和順序可由 `scripts/build_vocab.py` 轉換；此程式會保留已有的完整字庫。可執行 `python3 -m unittest discover -s tests` 檢查轉換程式。

字表的出處和授權見 [LICENSE-DATA.md](LICENSE-DATA.md)。

如需從 ECDICT CSV 重建離線釋義，先準備 Python 套件 `opencc-python-reimplemented==0.1.7`，再執行 `python3 scripts/build_glosses.py /path/to/ecdict.csv`。核對來源版本見授權文件。
