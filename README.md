# Vocabulary — 個人英文單字抽背 PWA

可安裝到 iPhone 主畫面的免費單字抽背 App。使用 HTML/CSS/JavaScript、IndexedDB、GitHub Pages，無需後端服務。

## 已完成（第一版 MVP）

- 首次部署時下載 Lexifold TOEIC 4,027 字，**只建立一次核心字庫快照**，寫入倉庫的 `data/core.json`。往後更新程式不會重新下載或覆蓋這份核心清單。
- 所有單字混合抽背，不依核心/自訂來源或 TOEIC 等級篩選；可篩選「全部／未標記／不熟練／普通／熟練」。
- 每輪打亂單字、不重複抽取；全部抽完才重新洗牌。
- 每次標記熟練度、輸入筆記、新增／刪除自訂單字時，立即寫入 iPhone 的 IndexedDB。
- 單字卡與詳細頁有一鍵開啟 Cambridge Dictionary 和複製單字。
- JSON 手動「建立備份」「載入備份」，可自行存入「我的 iPhone」或 iCloud Drive。
- 離線 PWA（初始化過一次並確保完成快取後，離線仍可抽背）。

**尚未完成：**繁體中文解釋、詞根、歷史詞源與例句的批次資料建立及自動查詞。現在詳細頁會顯示「尚未補齊」，不會假裝已經查到。這部分會在下一階段以合法可用的開放資料加入，且不使用 AI API 或自行轉換 KK/DJ 音標。

## 第一次用 GitHub Pages 部署（不用安裝開發工具）

1. 到 [GitHub](https://github.com/new) 建立新的 **Public** repository，例如 `vocabulary`。**不要勾選**「Add a README file」（避免跟這份檔案衝突）。
2. 將下載的 ZIP 解壓縮，**上傳資料夾裡面的全部檔案和目錄到 repository 根目錄**。一定要包含隱藏資料夾 `.github/workflows/deploy.yml`、`scripts/`、`data/` 和網站檔案。可在 GitHub repository 點 **Add file → Upload files**，拖入解壓縮後的所有檔案與資料夾，再 **Commit changes** 到 `main`。
3. 到 repository 的 **Settings → Pages → Build and deployment → Source**，選 **GitHub Actions**。
4. 開啟 **Actions → Build and deploy vocabulary PWA** 查看工作流程。第一次執行會從官方下載 TOEIC TSV、驗證 **4,027 筆**，把快照提交到 `data/core.json`，然後發佈網站。如果網路或原始檔欄位變動造成檢查失敗，Action 會停止而**不會用不完整的字庫取代它**。
5. 成功後到 Settings → Pages 查看網址，形式通常是 `https://你的帳號.github.io/vocabulary/`。
6. 用 iPhone 的 **Safari** 開啟該網址 → 分享 → **加入主畫面**。

> 部分 GitHub 帳戶或倉庫政策會禁止 Actions 回寫 repository。如首次部署在 `git push` 步驟失敗，進入 **Settings → Actions → General → Workflow permissions**，啟用 **Read and write permissions**，再到 Actions 重新執行流程（若有管理權限）。

## 更新 App

在 GitHub 修改 `app.js`、`style.css` 等檔案並提交，Actions 會再次部署。

**不會重新下載 Lexifold 字庫**：`scripts/build_vocab.py` 發現 `data/core.json` 已經是完整的 4,027 字，就直接停止。這是有意設計的唯讀快照。

## 資料安全

- **程式碼 / 核心詞條**：存於 GitHub。
- **熟練度 / 個人筆記 / 新增單字**：只存在 iPhone 本機 IndexedDB；不會隨 GitHub 更新清除（在同一網站來源下）。
- **備份**：設定 → 建立備份 JSON，確認檔案已存入 Files；設定 → 載入備份 JSON。
- **特別注意**：換手機、清除 Safari 網站資料、改變網站網址或刪除主畫面 App，可能使本機資料無法沿用。請定期備份。若同時開啟主畫面 App 與 Safari 網頁，儲存空間隔離行為可能隨 iOS 版本而異；請在同一個入口持續學習，不要假定兩處資料會同步。

## 開發與測試

在專案根目錄執行：

```bash
python3 -m http.server 8080
```

然後開啟 `http://localhost:8080/`。初次本地測試時，`data/core.json` 還是空白快照，因此會提示「尚未初始化」，直到部署 Action 取得正式 4,027 字為止。

下載後，可用以下指令核對：

```bash
python3 scripts/build_vocab.py
```

不會覆蓋已有的完整快照。

## 授權與來源

- Lexifold course word list: https://lexifold.com/word-lists/ （CC BY-SA 4.0）
- Original lists: New General Service List 1.2, TOEIC Service List 1.2, New Academic Word List 1.2 (Browne, Culligan, Phillips)
- License: https://creativecommons.org/licenses/by-sa/4.0/
- Cambridge: links to external Cambridge Dictionary pages only; no copied Cambridge audio or IPA data.
- TOEIC® is a trademark of ETS; this project is unaffiliated.

本專案不含 Lexifold 受版權保護的釋義、例句、圖片或語音。
