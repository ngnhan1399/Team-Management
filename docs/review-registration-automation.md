# Reviewer Registration Automation

## Mục tiêu

- Thêm luồng reviewer cho cộng tác viên duyệt bài:
  - nút `Đã duyệt`
  - nút `Đăng ký bài duyệt`
- Khi reviewer đăng ký bài duyệt, hệ thống sẽ ghi bài vào Google Sheet:
  - Spreadsheet: `157reP9SMWXgV47XHPcUJNqo1RicwS6vsqQvOlEW5F8Q`
  - Tab: `Việt Nguyễn`

## Luồng hiện tại

1. Reviewer nhận bài hoặc được gán bài trong `ArticlesPage`.
2. Reviewer bấm `Đã duyệt`.
3. Hệ thống gọi `PUT /api/articles` với `action = "mark-reviewed"` và cập nhật trạng thái bài sang `Published`.
4. Reviewer bấm `Đăng ký bài duyệt`.
5. Hệ thống gọi `POST /api/review-registrations`.
6. Backend tạo hoặc cập nhật bản ghi `review_registrations`, rồi queue job nền.
7. Job nền gọi Apps Script web app để ghi dữ liệu vào sheet.
8. Trạng thái mới nhất của `review_registrations` được gắn ngược vào payload `/api/articles`.

## Metadata bài viết

`GET /api/articles` hiện gắn thêm:

- `reviewRegistrationStatus`
- `reviewRegistrationStatusLabel`
- `reviewRegistrationMessage`
- `reviewRegistrationRowNumber`
- `reviewRegistrationSheetName`

UI desktop/mobile dùng trực tiếp các field này để hiển thị trạng thái từng bài.

## Quy tắc ghi sheet

Apps Script mẫu: `output/review-registration.workdocker.gs`

Quy tắc đã chốt từ sheet thật:

- Không tạo tab mới.
- Luôn ghi trong tab `Việt Nguyễn`.
- Trong tab này, tìm block tháng mới nhất theo cột A có dạng `Tháng X`.
- Trong block tháng mới nhất:
  - tìm dòng đầu tiên mà `Link` và `CTV Viết` còn trống
  - nếu không còn dòng trống, chèn thêm một dòng vào cuối block
- Ghi các cột:
  - A: ngày bài viết
  - B: link bài viết
  - C: tên CTV viết
  - D: reviewer, mặc định `Việt Nguyễn`
  - E: BTV quản lý, để trống nếu chưa có
  - F -> L: tick toàn bộ checkbox `TRUE`

## Env cần cấu hình

Trong app:

- `REVIEW_REGISTRATION_SCRIPT_WEB_APP_URL`
- `REVIEW_REGISTRATION_SCRIPT_SECRET`

Trong Apps Script:

- Script property `REVIEW_REGISTRATION_SCRIPT_SECRET`

## Lưu ý vận hành

- Đây là luồng Apps Script ghi trực tiếp vào Google Sheet, không phải Google Form.
- Nếu reviewer chưa có cấu hình profile sheet, backend sẽ chặn đăng ký.
- Nếu bài chưa có link hoặc chưa ở trạng thái đã duyệt, backend sẽ chặn đăng ký.
- Khi sửa logic sheet thật, phải cập nhật đồng thời:
  - `src/lib/review-registration.ts`
  - `src/lib/review-registration-automation.ts`
  - `output/review-registration.workdocker.gs`
