# Google Sheets Two-Way Sync

Hệ thống hiện hỗ trợ đồng bộ hai chiều:

- `Google Sheet -> Tool`: khi sửa sheet, Apps Script gọi webhook của app để kéo dữ liệu về.
- `Tool -> Google Sheet`: khi đổi trạng thái/link/người duyệt/ghi chú trong app, hệ thống gọi ngược sang Apps Script web app để cập nhật dòng tương ứng trong sheet gốc.
- `Tool -> Google Sheet (tạo mới)`: khi tạo bài viết trực tiếp trong tool, hệ thống sẽ tự ghi bài đó sang tab tháng tương ứng trong Google Sheet gốc để lưu trữ.

## Biến môi trường cần có trên app

```env
GOOGLE_SHEETS_ARTICLE_SOURCE_URL=https://docs.google.com/spreadsheets/d/1Uj8iA0R5oWmONenkESHZ8i7Hc1D8UOk6ES6olZGTbH8/edit?gid=75835251#gid=75835251
GOOGLE_SHEETS_WEBHOOK_SECRET=replace_with_a_long_random_secret
GOOGLE_SHEETS_SCRIPT_WEB_APP_URL=https://script.google.com/macros/s/your_deployment_id/exec
GOOGLE_SHEETS_SCRIPT_SECRET=replace_with_the_same_secret_used_in_apps_script
```

`GOOGLE_SHEETS_SCRIPT_SECRET` có thể dùng cùng giá trị với `GOOGLE_SHEETS_WEBHOOK_SECRET` để cấu hình gọn hơn.

## Apps Script

Đã có sẵn file script mẫu đầy đủ tại:

```text
output/google-sheets-webhook.workdocker.gs
```

File này đã bao gồm:

- `onEdit`
- `onChange`
- `doPost`
- nhận diện tab tháng linh hoạt
- cập nhật chiều ngược từ tool sang sheet
- thêm mới bài viết từ tool sang đúng tab tháng của sheet gốc

## Cách cài trên Google Sheet

1. Mở Google Sheet.
2. Vào `Tiện ích > Apps Script`.
3. Xóa code cũ và dán toàn bộ nội dung từ `output/google-sheets-webhook.workdocker.gs`.
4. Lưu lại.
5. Tạo 2 trigger installable:
   - `onEdit` với loại sự kiện `Đang chỉnh sửa`
   - `onChange` với loại sự kiện `Đang thay đổi`

## Triển khai Apps Script web app

Để app cập nhật ngược sang Google Sheet, script cần được deploy thành web app:

1. Trong Apps Script, bấm `Triển khai`.
2. Chọn `Lần triển khai mới`.
3. Loại triển khai: `Ứng dụng web`.
4. `Thực thi với quyền`: `Tôi`.
5. `Ai có quyền truy cập`: `Bất kỳ ai có đường liên kết`.
6. Bấm `Triển khai`.
7. Copy URL web app vừa tạo.
8. Dán URL đó vào biến môi trường `GOOGLE_SHEETS_SCRIPT_WEB_APP_URL` của app.
9. Dán cùng secret của Apps Script vào `GOOGLE_SHEETS_SCRIPT_SECRET`.

## Luồng đồng bộ chiều ngược

Khi một bài viết đã có liên kết với Google Sheet:

- đổi `Trạng thái` trong app
- đổi `Link bài viết`
- đổi `Người duyệt`
- đổi `Ghi chú`
- gửi review/fix

thì app sẽ gọi sang Apps Script web app để cập nhật các cột tương ứng trong sheet:

- `Tình trạng duyệt`
- `Người duyệt`
- `Nội dung sửa / Note`
- `Link bài viết`

## Khi tạo bài mới trực tiếp trong tool

Nếu bạn tạo bài mới bằng form trong công cụ:

- hệ thống sẽ xác định tab tháng theo `Ngày viết`
- thử tìm bài tương ứng trong tab đó để tránh trùng
- nếu chưa có thì ưu tiên dùng lại **hàng trống đầu tiên còn sẵn trong toàn bộ vùng bảng bài viết**
- không còn `insert row` chen giữa sheet như trước, nên sẽ không đẩy lệch các block KPI/nhuận ở bên phải
- nếu không còn hàng trống sẵn trong vùng bài viết thì script sẽ **dừng và báo lỗi**, không tự thêm hàng mới
- đồng thời tạo liên kết `article_sync_links` để các lần sync sau tiếp tục đi đúng cùng một dòng

Các trường sẽ được ghi sang sheet theo mapping:

- `ID bài viết` -> `ID bài`
- `Ngày viết` -> `Ngày viết`
- `Tiêu đề` -> `Tên bài viết`
- `Loại bài + Loại nội dung` -> `Loại bài viết`
- `Độ dài` -> `Độ dài`
- `Bút danh` -> `Bút danh`
- `Trạng thái` -> `Tình trạng duyệt`
- `Ghi chú` -> `Nội dung sửa`
- `Người duyệt` -> `Người duyệt`
- `Link bài viết` -> `Link bài viết`

## Quy ước trạng thái

Ánh xạ từ app sang Google Sheet:

- `Published` / `Approved` -> `Done`
- `Submitted` / `Reviewing` / `NeedsFix` -> `Pending`
- `Rejected` -> `Rejected`
- `Draft` -> để trống

## Ghi chú kỹ thuật

- Hệ thống dùng `article_sync_links` để biết bài nào thuộc dòng nào trong sheet.
- Nếu khóa nhận diện dòng thay đổi sau khi app cập nhật dữ liệu, lần sync sau vẫn sẽ tự bắt lại đúng dòng thay vì xóa nhầm bài.
- Các tab mới thêm vào vẫn được nhận diện nếu tên tab có dạng tháng/năm, ví dụ `Tháng 032026`, `Tháng 03/2026`, `Tháng 3 2026`, hoặc `Bản sao của Tháng ...`.
- Script Apps Script mới chỉ copy format/data validation trong vùng cột của bảng bài viết, không chạm vào các cột KPI/nhuận ở bên phải.
- Khi xóa bài từ app, script chỉ **xóa dữ liệu trong vùng bài viết của dòng đó**, không `delete row` để tránh kéo lệch cả sheet.

## Khi cập nhật Apps Script

Sau mỗi lần sửa file:

```text
output/google-sheets-webhook.workdocker.gs
```

cần làm lại các bước sau trên Google Apps Script:

1. Dán lại toàn bộ nội dung script mới.
2. Lưu file.
3. `Triển khai` lại web app.
4. Dùng URL web app mới nhất nếu Google tạo deployment URL khác.

Nếu không redeploy lại Apps Script, web app cũ vẫn sẽ chạy logic cũ và tiếp tục thay đổi cấu trúc sheet ngoài ý muốn.


