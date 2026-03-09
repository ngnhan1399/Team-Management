# Google Sheets Webhook Sync

Tính năng này cho phép Google Apps Script gọi trực tiếp vào hệ thống mỗi khi bảng tính thay đổi, để đồng bộ danh sách bài viết gần như ngay lập tức.

## Biến môi trường cần có

```env
GOOGLE_SHEETS_ARTICLE_SOURCE_URL=https://docs.google.com/spreadsheets/d/1Uj8iA0R5oWmONenkESHZ8i7Hc1D8UOk6ES6olZGTbH8/edit?gid=75835251#gid=75835251
GOOGLE_SHEETS_WEBHOOK_SECRET=replace_with_a_long_random_secret
```

`GOOGLE_SHEETS_WEBHOOK_SECRET` hiện là biến tùy chọn để bạn tự xoay secret riêng sau này. Nếu chưa set, hệ thống vẫn có sẵn một bootstrap secret nội bộ để chạy nhanh lần đầu.

## Webhook URL

```text
https://your-domain/api/articles/google-sync/webhook
```

## Google Apps Script mẫu

```javascript
const WEBHOOK_URL = 'https://your-domain/api/articles/google-sync/webhook';
const WEBHOOK_SECRET = 'replace_with_a_long_random_secret';
const SOURCE_URL = 'https://docs.google.com/spreadsheets/d/1Uj8iA0R5oWmONenkESHZ8i7Hc1D8UOk6ES6olZGTbH8/edit?gid=75835251#gid=75835251';

function normalizeSheetName_(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMonthlySheetName_(sheetName) {
  const normalized = normalizeSheetName_(sheetName);
  const withoutCopyPrefix = normalized.replace(/^Ban sao cua\s+/i, '').trim();

  const match =
    withoutCopyPrefix.match(/^Thang\s*(\d{1,2})(\d{4})$/i)
    || withoutCopyPrefix.match(/^Thang\s*(\d{1,2})[\s/._-]+(\d{4})$/i)
    || withoutCopyPrefix.match(/^Thang[\s/._-]+(\d{1,2})[\s/._-]+(\d{4})$/i);

  if (!match) return null;

  return {
    sheetName,
    month: Number(match[1]),
    year: Number(match[2]),
  };
}

function sendWebhookPayload_(payload) {
  if (!payload) return;

  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-google-sheets-secret': WEBHOOK_SECRET,
    },
    payload: JSON.stringify({
      sourceUrl: SOURCE_URL,
      sheetName: payload.sheetName,
      month: payload.month,
      year: payload.year,
    }),
    muteHttpExceptions: true,
  });
}

function onEdit(e) {
  const sheet = e && e.range ? e.range.getSheet() : SpreadsheetApp.getActiveSheet();
  sendWebhookPayload_(parseMonthlySheetName_(sheet.getName()));
}

function onChange(e) {
  const spreadsheet = e && e.source ? e.source : SpreadsheetApp.getActiveSpreadsheet();
  const activeSheet = spreadsheet ? spreadsheet.getActiveSheet() : null;
  if (!activeSheet) return;
  sendWebhookPayload_(parseMonthlySheetName_(activeSheet.getName()));
}
```

## Cách chạy

1. Mở Google Sheet.
2. Vào `Extensions > Apps Script`.
3. Dán script ở trên.
4. Tạo `installable trigger` cho hàm `onEdit`.
5. Tạo thêm `installable trigger` cho hàm `onChange`.
6. Lưu và cấp quyền cho Apps Script.

## Hành vi hiện tại

- Nếu người dùng sửa tab tháng, webhook sẽ gọi về app gần như ngay lập tức.
- Hệ thống nhận diện được cả tab kiểu `Tháng 032026`, `Tháng 03/2026`, `Tháng 3 2026`, và cả `Bản sao của Tháng ...`.
- Các sheet mới thêm vào vẫn được nhận diện nếu tên tab khớp định dạng tháng/năm.
- Bài đã có trong hệ thống sẽ được đối soát và cập nhật lại trạng thái/dữ liệu theo sheet gốc, không chỉ thêm mới.
- Nếu sửa các tab không phải tab tháng, webhook sẽ tự bỏ qua.
