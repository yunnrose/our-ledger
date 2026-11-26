# 新版帳本介面

主標題：佩筠 × Benson 的小帳本♡

副標題：一起吃飯、一起旅行，也一起記下幸福。

此目錄為新版介面開發區，與現行正式網站及舊 Firebase 路徑隔離。初始資料為空；目前僅提供 UI prototype，不會寫入本機或雲端資料。

## 上線前必須完成
- Firebase Authentication 的邀請碼兌換與固定 UID 綁定（必須由可信任後端驗證，不能只在瀏覽器驗證）。
- Realtime Database 新的 /ourLittleLedger/ 專屬資料結構與最小權限規則；先讀取並保留舊有 /transactions/、/logs/ 規則。
- 支出、分帳、還款、撤銷與 audit log 的完整資料層及測試。
- 月曆、搜尋、統計、Excel/JSON 匯出。
- 部署前完成安全規則與雙帳號同步測試。

注意：此 prototype 不可視為已部署的正式帳本。