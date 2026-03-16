# Content Work Automation

## Mục tiêu

- Khi `CTV` lưu bài mới trên web app, hệ thống có thể tạo một job `Content Work`.
- Job này gọi một `Google Apps Script web app` dùng chung cho team.
- Apps Script sẽ:
  - submit form `Content Work 2024 ver 2`
  - dò đúng dòng vừa phát sinh trong spreadsheet Content Work
  - điền `link bài viết` vào cột link
  - không tự điền cột `Nguồn` nếu app không truyền nguồn riêng

## Kiến trúc

- `Web app -> DB`
  - lưu trạng thái vào bảng `content_work_registrations`
- `Web app -> Apps Script`
  - gọi `POST /doPost` với `action = registerContentWork`
- `Apps Script -> Google Form`
  - tải `viewform` để lấy `fbzx` + `partialResponse`
  - rồi gửi trực tiếp vào `formResponse` của Google Form công khai
- `Apps Script -> Google Sheet`
  - dùng `SpreadsheetApp.openById(...)`
  - tìm tab theo `gid`
  - dò dòng mới nhất khớp `title + penName + category`, với cột link còn trống

## File chính

- App:
  - [E:/Data Management Project/ctv-management/src/app/api/content-work/route.ts](E:/Data%20Management%20Project/ctv-management/src/app/api/content-work/route.ts)
  - [E:/Data Management Project/ctv-management/src/lib/content-work-automation.ts](E:/Data%20Management%20Project/ctv-management/src/lib/content-work-automation.ts)
  - [E:/Data Management Project/ctv-management/src/lib/content-work-registration.ts](E:/Data%20Management%20Project/ctv-management/src/lib/content-work-registration.ts)
  - [E:/Data Management Project/ctv-management/src/app/components/ContentWorkPage.tsx](E:/Data%20Management%20Project/ctv-management/src/app/components/ContentWorkPage.tsx)
- Apps Script:
  - [E:/Data Management Project/ctv-management/output/content-work-automation.workdocker.gs](E:/Data%20Management%20Project/ctv-management/output/content-work-automation.workdocker.gs)

## Env cần cấu hình trên app

```env
CONTENT_WORK_SCRIPT_WEB_APP_URL=
CONTENT_WORK_SCRIPT_SECRET=
```

## Cách cài Apps Script

1. Mở Google Apps Script bằng tài khoản automation chung có quyền chỉnh sửa với sheet Content Work.
2. Tạo project script mới.
3. Dán nội dung từ [E:/Data Management Project/ctv-management/output/content-work-automation.workdocker.gs](E:/Data%20Management%20Project/ctv-management/output/content-work-automation.workdocker.gs).
4. Sửa `CONTENT_WORK_SECRET` cho khớp với `CONTENT_WORK_SCRIPT_SECRET`.
5. `Deploy > New deployment > Web app`.
6. Chọn chạy bằng tài khoản automation chung.
7. Cấp quyền truy cập cho web app theo nhu cầu nội bộ.
8. Chạy hàm `authorizeContentWorkScopes` một lần trong Apps Script và bấm cấp quyền đầy đủ.
9. Lấy URL web app và điền vào `CONTENT_WORK_SCRIPT_WEB_APP_URL`.

## Trạng thái job

- `queued`: vừa xếp hàng
- `submitting_form`: đang gửi form
- `form_submitted`: form đã gửi, nhưng chưa điền link xong
- `completed`: đã gửi form và điền link xong
- `failed`: lỗi, cần retry

## Lưu ý

- Thiết kế hiện tại dùng **một tài khoản Google automation chung**, không lưu đăng nhập Google riêng của từng CTV.
- Bản script mới không cần quyền `edit form` để gửi Google Form nữa, nhưng vẫn cần quyền chỉnh sửa sheet Content Work để điền link bài viết.
- Hệ thống mặc định để trống cột `Nguồn`; không còn fallback lấy `link bài viết` để điền vào cột này.
- Bản script phải lấy `fbzx` và `partialResponse` từ `viewform` trước khi submit. Nếu bỏ bước này, Google Form sẽ trả `HTTP 400`.
- Nếu Apps Script báo thiếu quyền `UrlFetchApp.fetch`, mở editor và chạy `authorizeContentWorkScopes` một lần để cấp quyền cho tài khoản automation.
- Nếu Apps Script không tìm thấy đúng dòng để điền link, job sẽ dừng ở `form_submitted` hoặc `failed`; CTV có thể retry từ tab `Content Work`.
- Mapping danh mục Content Work hiện ưu tiên các loại bài đang có trong app. Nếu phát sinh loại mới, cập nhật ở [E:/Data Management Project/ctv-management/src/lib/content-work-registration.ts](E:/Data%20Management%20Project/ctv-management/src/lib/content-work-registration.ts).
