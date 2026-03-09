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

function onEdit(e) {
  const sheet = e && e.range ? e.range.getSheet() : SpreadsheetApp.getActiveSheet();
  const sheetName = sheet.getName();

  if (!/^Tháng\s+\d{2}\d{4}$/i.test(sheetName)) {
    return;
  }

  const match = sheetName.match(/(\d{2})(\d{4})$/);
  if (!match) {
    return;
  }

  const payload = {
    sourceUrl: SOURCE_URL,
    sheetName: sheetName,
    month: Number(match[1]),
    year: Number(match[2]),
  };

  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-google-sheets-secret': WEBHOOK_SECRET,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}
```

## Cách chạy

1. Mở Google Sheet.
2. Vào `Extensions > Apps Script`.
3. Dán script ở trên.
4. Tạo `installable trigger` cho hàm `onEdit`.
5. Lưu và cấp quyền cho Apps Script.

## Hành vi hiện tại

- Nếu người dùng sửa đúng tab tháng, webhook sẽ gọi về app.
- Hệ thống chỉ thêm bài chưa tồn tại.
- Bài đã có sẵn sẽ được bỏ qua để tránh trùng lặp khi sync nhiều lần.
- Nếu sửa các tab không phải dạng `Tháng MMYYYY`, webhook sẽ tự bỏ qua.
