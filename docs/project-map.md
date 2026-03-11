# Bản Đồ Dự Án Chi Tiết

Tài liệu này mô tả cấu trúc thực tế của dự án theo mã nguồn hiện tại, không theo bản demo hoặc tài liệu cũ.

Ngày cập nhật: `2026-03-11`

## 1. Mục tiêu hệ thống

`ctv-management` là ứng dụng web nội bộ để quản lý vận hành đội ngũ sản xuất nội dung:

- Quản lý bài viết từ lúc tạo đến lúc xuất bản
- Quản lý cộng tác viên, reviewer, admin và phạm vi theo team
- Theo dõi review, bình luận, thông báo, feedback và audit log
- Tính nhuận bút, quản lý ngân sách và workflow thanh toán
- Đồng bộ dữ liệu bài viết hai chiều với Google Sheets

Trọng tâm hiện tại của dự án là vận hành ổn định cho môi trường thật, không còn ưu tiên tính năng AI như bản tài liệu cũ.

## 2. Stack và môi trường chạy

### Tech stack

- `Next.js 16.1.6` với App Router
- `React 19`
- `TypeScript`
- `Drizzle ORM`
- `PostgreSQL` qua `pg`
- `JWT + httpOnly cookie` cho xác thực
- `bcryptjs` cho hash mật khẩu
- `xlsx` cho import/export Excel
- `Playwright` cho e2e smoke test

### Runtime và triển khai

- Local dev: `npm run dev`
- Production build: `npm run build` rồi `npm run start`
- Định hướng deploy: `Dockerfile` + `DigitalOcean App Platform`
- Health check: `GET /api/health`

### Biến môi trường chính

- `JWT_SECRET`
- `DATABASE_URL`
- `APP_ORIGIN`
- `APP_ORIGINS`
- `DATABASE_SSL`
- `GOOGLE_SHEETS_ARTICLE_SOURCE_URL`
- `GOOGLE_SHEETS_WEBHOOK_SECRET`
- `GOOGLE_SHEETS_SCRIPT_WEB_APP_URL`
- `GOOGLE_SHEETS_SCRIPT_SECRET`

## 3. Cấu trúc thư mục quan trọng

```text
ctv-management/
├── docs/
│   ├── codex-handoff.md
│   ├── codex-thread-safety.md
│   ├── digitalocean-production-plan.md
│   ├── google-sheets-webhook.md
│   └── project-map.md
├── scripts/
│   ├── db-bootstrap.mjs
│   ├── seed-db.mjs
│   ├── migrate-sqlite-to-postgres.mjs
│   ├── smoke-test.mjs
│   └── e2e-smoke.mjs
├── src/
│   ├── app/
│   │   ├── api/
│   │   ├── components/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── db/
│   │   ├── index.ts
│   │   ├── schema.ts
│   │   └── seed.ts
│   ├── lib/
│   └── types/
├── .github/workflows/ci.yml
├── .env.example
├── Dockerfile
├── package.json
└── README.md
```

## 4. Cấu trúc ứng dụng frontend

### Entry flow

- `src/app/page.tsx`
  - Bọc toàn app trong `AuthProvider`
- `src/app/components/auth-context.tsx`
  - Tải user hiện tại từ `GET /api/auth/me`
  - Expose `login`, `register`, `logout`, `refreshUser`
- `src/app/components/AppRouter.tsx`
  - Chia 3 trạng thái: chưa đăng nhập, bắt buộc đổi mật khẩu, vào app chính
- `src/app/components/MainApp.tsx`
  - Sidebar, mobile topbar, lazy-load page theo tab
  - Nhận realtime qua SSE từ `/api/realtime`
  - Đồng bộ badge thông báo chưa đọc

### Các page chính trong app shell

- `DashboardPage`
  - Lấy dữ liệu từ `/api/statistics`
- `NotificationsPage`
  - Đọc, đánh dấu đã đọc, gửi thông báo nếu là admin
- `FeedbackPage`
  - User gửi feedback, admin cập nhật trạng thái
- `ArticlesPage`
  - Module lớn nhất, quản lý gần như toàn bộ vòng đời bài viết
- `EditorialTasksPage`
  - Lịch biên tập, deadline, reminder
- `TeamPage`
  - CTV, reviewer, tài khoản linked user, team management
- `RoyaltyPage`
  - Dashboard nhuận bút, bảng giá, tính toán, payment workflow
- `AuditLogsPage`
  - Chỉ leader mới xem được
- `ProfilePage`
  - Hồ sơ người dùng hiện tại

## 5. Mô hình dữ liệu

Schema chính nằm ở `src/db/schema.ts`.

### Bảng lõi

- `users`
  - Tài khoản đăng nhập
  - Role ở mức hệ thống: `admin | ctv`
  - Có `isLeader` để phân biệt admin hệ thống và admin thường theo team
- `teams`
  - Team vận hành nội dung
  - Có owner riêng
- `collaborators`
  - Hồ sơ nghiệp vụ của thành viên
  - Role ở mức cộng tác viên: `writer | reviewer`
- `articles`
  - Bài viết trung tâm của toàn hệ thống
  - Có `reviewLink`, `createdByUserId`, `teamId`
- `article_sync_links`
  - Bản đồ nối giữa article trong DB và dòng/tab trên Google Sheets

### Bảng vận hành

- `article_comments`
- `article_reviews`
- `editorial_tasks`
- `kpi_records`
- `royalty_rates`
- `payments`
- `monthly_budgets`
- `notifications`
- `feedback_entries`
- `audit_logs`
- `realtime_events`

### Ghi chú quan trọng

- App bootstrap schema runtime trong `src/db/index.ts`
- Hệ thống tự tạo `Team mặc định` để tiếp nhận dữ liệu legacy
- `bootstrap_schema_version` hiện tại là `5`

## 6. Phân quyền hiện tại

### Tầng tài khoản

- `admin`
  - Quản lý dữ liệu team
  - Nếu `isLeader = true` thì thấy được toàn hệ thống
  - Nếu `isLeader = false` thì bị scope theo `teamId`
- `ctv`
  - Đăng nhập bằng tài khoản gắn với `collaborator`
  - Chỉ thấy phần dữ liệu thuộc phạm vi của mình

### Tầng nghiệp vụ cộng tác viên

- `writer`
  - Xem bài của mình
  - Tạo/sửa bài trong phạm vi được phép
  - Comment và theo dõi nhuận bút cá nhân
- `reviewer`
  - Ngoài phạm vi writer còn có quyền xem hàng chờ duyệt hoặc bài được giao duyệt
- `leader`
  - Là admin đặc biệt
  - Có quyền audit log, quản lý nhiều team, chuyển owner team

## 7. Các module nghiệp vụ theo domain

### 7.1. Auth

File chính:

- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/register/route.ts`
- `src/app/api/auth/change-password/route.ts`
- `src/app/api/auth/me/route.ts`
- `src/lib/auth.ts`
- `src/lib/rate-limit.ts`

Luồng:

1. Login bằng email/password
2. Route login kiểm tra rate-limit theo IP + email
3. Tạo JWT, lưu vào cookie `ctv_auth_token`
4. `AuthProvider` gọi `/api/auth/me` để hydrate user vào frontend
5. Nếu `mustChangePassword = true` thì vào màn đổi mật khẩu

Điểm đặc biệt:

- `register` không phải đăng ký công khai
- Chỉ email đã tồn tại trong `collaborators` mới được tự kích hoạt tài khoản CTV lần đầu

### 7.2. Team và cộng tác viên

File chính:

- `src/app/api/teams/route.ts`
- `src/app/api/collaborators/route.ts`
- `src/app/components/TeamPage.tsx`

Chức năng:

- Tạo team mới
- Tạo admin owner ban đầu cho team
- Chuyển owner team
- CRUD collaborator
- Tạo linked user tự động khi thêm CTV có email
- Phân tách danh sách writer và reviewer

Điểm đáng chú ý:

- Admin thường bị scope theo team của mình
- Leader có thể thao tác cross-team
- Nhiều route dùng helper `resolveScopedTeamId`, `canAccessTeam`

### 7.3. Bài viết

File chính:

- `src/app/components/ArticlesPage.tsx`
- `src/app/components/ArticlePreviewPanel.tsx`
- `src/app/api/articles/route.ts`
- `src/lib/article-category.ts`
- `src/lib/article-status.ts`
- `src/lib/review-link.ts`

Chức năng:

- Danh sách bài viết có filter/search/pagination
- CRUD bài viết
- Gắn người duyệt, link duyệt, ghi chú
- Tính `canDelete`, `commentCount`, `unreadCommentCount`
- CMS preview panel để mở link review/CMS mà giữ session
- Xóa một bài hoặc xóa hàng loạt theo preview

Điểm kỹ thuật:

- Tạo/sửa/xóa đều ghi `audit log`
- Tạo/sửa/xóa bài đều phát `realtime event`
- Xóa bài có cascade xóa `comments`, `reviews`, `notifications`, `article_sync_links`
- Xóa bài sẽ reset `payments` liên quan để tránh lệch dữ liệu
- Sync Google Sheet khi create/update/delete chạy theo background, ưu tiên response nhanh

### 7.4. Comment và review bài viết

File chính:

- `src/app/api/articles/comments/route.ts`
- `src/app/api/articles/review/route.ts`

Chức năng:

- Bình luận theo bài viết
- Mention bằng cú pháp `@name`
- Attachment URL
- Đánh dấu comment notification là đã đọc khi mở modal
- Gửi thông báo cho owner/reviewer/admin phù hợp

Ghi chú:

- Luồng review cũ đã được gom về hướng comment + review state tập trung
- Reviewer chỉ thấy bài thuộc scope duyệt của mình

### 7.5. Import Excel

File chính:

- `src/app/api/articles/import/analyze/route.ts`
- `src/app/api/articles/import/route.ts`
- `src/lib/article-import.ts`

Chức năng:

- Phân tích workbook trước khi import
- Dò sheet phù hợp, header row, cột dữ liệu
- Gợi ý mapping field
- Dry-run preview trước khi import thật
- Hỗ trợ thay thế dữ liệu cũ khi import

Điểm mạnh:

- Hỗ trợ file có merge cell, hidden sheet, title row
- Có logic nhận diện header tương đối linh hoạt

### 7.6. Google Sheets sync

File chính:

- `src/app/api/articles/google-sync/route.ts`
- `src/app/api/articles/google-sync/webhook/route.ts`
- `src/lib/google-sheet-sync.ts`
- `src/lib/google-sheet-mutation.ts`
- `docs/google-sheets-webhook.md`

Nhiệm vụ:

- Kéo dữ liệu bài viết từ Google Sheets vào app
- Chọn tab theo `tháng/năm` hoặc tab mới nhất
- Reconcile cả workbook nếu cần
- Mirror tạo/sửa/xóa từ app ngược về Apps Script
- Ghi `article_sync_links` để map row chính xác

Rủi ro đang còn:

- Apps Script cần redeploy nếu thay đổi webhook handler
- Luồng xóa `web -> Google Sheet` hiện là non-blocking
  - Xóa trên web vẫn thành công
  - Nếu sync sheet lỗi thì chỉ trả warning và ghi log

### 7.7. Lịch biên tập

File chính:

- `src/app/api/editorial-tasks/route.ts`
- `src/app/api/editorial-tasks/reminders/route.ts`
- `src/app/components/EditorialTasksPage.tsx`

Chức năng:

- Tạo task biên tập
- Giao người phụ trách
- Theo dõi trạng thái `todo | in_progress | done | overdue`
- Đặt `dueDate`, `remindAt`, `priority`
- Tạo notification nhắc việc

### 7.8. KPI

File chính:

- `src/app/api/kpi/route.ts`

Chức năng:

- Lưu KPI theo `month/year/penName`
- Admin tạo hoặc cập nhật record
- CTV chỉ xem record của mình

### 7.9. Nhuận bút và ngân sách

File chính:

- `src/app/api/royalty/route.ts`
- `src/lib/royalty.ts`
- `src/app/components/RoyaltyPage.tsx`

Chức năng:

- Trả bảng giá đang active
- Trả dashboard 6 tháng
- Tính tổng nhuận bút theo tháng, năm, CTV
- Quản lý ngân sách tháng
- Tính top writers, breakdown theo loại bài

Quy ước:

- Chỉ bài có trạng thái `Published` hoặc `Approved` mới vào nhuận bút

### 7.10. Thanh toán

File chính:

- `src/app/api/payments/route.ts`

Chức năng:

- Sinh payment theo kỳ
- Parse breakdown chi tiết từ JSON
- Workflow `pending -> approved -> paid`
- Gửi notification khi trạng thái thanh toán thay đổi

Điểm kỹ thuật:

- Nếu CTV chưa có payment record nhưng có dữ liệu bài đủ điều kiện, route có thể trả `estimated` để frontend vẫn hiển thị

### 7.11. Notifications và realtime

File chính:

- `src/app/api/notifications/route.ts`
- `src/app/api/realtime/route.ts`
- `src/lib/notifications.ts`
- `src/lib/realtime.ts`
- `src/app/components/RealtimeToastLayer.tsx`

Chức năng:

- Thông báo cá nhân
- Broadcast theo team nếu admin gửi
- SSE realtime
- Backfill event nếu browser reconnect
- Badge unread và toast nền

### 7.12. Feedback

File chính:

- `src/app/api/feedback/route.ts`
- `src/app/components/FeedbackPage.tsx`

Chức năng:

- User gửi bug/feature/improvement/other
- Admin cập nhật `new -> reviewing -> planned -> resolved`
- Có thể lưu `adminNotes`
- Khi trạng thái đổi sẽ notify lại người gửi

### 7.13. Dashboard, statistics, search, export

File chính:

- `src/app/api/statistics/route.ts`
- `src/app/api/search/route.ts`
- `src/app/api/export/route.ts`
- `src/app/components/DashboardPage.tsx`

Chức năng:

- Dashboard tổng hợp bài viết theo trạng thái, category, writer
- Search article nhanh theo title/pen name/articleId/category/notes
- Export danh sách bài viết sang Excel

## 8. Luồng dữ liệu quan trọng

### 8.1. Tạo bài viết

1. Frontend gửi `POST /api/articles`
2. Backend kiểm tra auth + team scope
3. Ghi DB vào `articles`
4. Queue background:
   - ghi audit log
   - mirror sang Google Sheets
   - phát realtime event

### 8.2. Sửa bài viết

1. Frontend gửi `PUT /api/articles`
2. Backend kiểm tra quyền theo owner/reviewer/admin
3. Update record
4. Nếu thay đổi field quan trọng thì mirror sang Google Sheets

### 8.3. Xóa bài viết

1. Frontend có thể xin preview trước
2. Backend load sync target từ `article_sync_links`
3. Cố xóa tương ứng trên Google Sheets
4. Xóa cascade trong DB
5. Reset payment bị ảnh hưởng
6. Ghi warning nếu sheet sync lỗi

### 8.4. Sync Google Sheets vào app

1. Người dùng trigger `/api/articles/google-sync`
2. App tải workbook `.xlsx` từ Google Sheets export URL
3. Chọn tab phù hợp
4. Chuẩn hóa mapping
5. So khớp theo `articleId`, `link`, composite key hoặc row key
6. Insert/update/delete bài tương ứng
7. Cập nhật `article_sync_links`

### 8.5. Generate payment

1. Admin gọi `POST /api/payments` với action `generate`
2. Hệ thống quét bài eligible theo tháng
3. Match bảng giá từ `royalty_rates`
4. Ghi payment records
5. Admin tiếp tục approve hoặc mark-paid

## 9. Bảo mật và guardrails

- Gần như toàn bộ route ghi dữ liệu đều gọi `enforceTrustedOrigin`
- Login có rate-limit theo IP + email
- JWT secret phải dài ít nhất 32 ký tự
- Cookie auth là `httpOnly`, `sameSite=strict`
- Scope team được kiểm tra nhiều tầng bằng `canAccessTeam`
- Audit log được ghi cho nhiều action quan trọng

## 10. Test, CI và script vận hành

### Script thường dùng

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run db:seed`
- `npm run db:migrate-sqlite`
- `npm run test:smoke`
- `npm run test:e2e-smoke`

### Kiểm tra tự động

- `scripts/smoke-test.mjs`
  - Kiểm tra schema và file API quan trọng
- `scripts/e2e-smoke.mjs`
  - Login admin
  - Đi qua các tab chính
  - Chạm vào mutation flow quan trọng
- `.github/workflows/ci.yml`
  - `npm ci`
  - chuẩn bị env
  - seed DB
  - lint
  - smoke
  - e2e smoke

## 11. Tệp nên mở đầu tiên khi tiếp quản dự án

- `AGENTS.md`
- `docs/codex-handoff.md`
- `docs/project-map.md`
- `src/db/schema.ts`
- `src/db/index.ts`
- `src/app/components/MainApp.tsx`
- `src/app/components/ArticlesPage.tsx`
- `src/app/api/articles/route.ts`
- `src/lib/google-sheet-sync.ts`
- `src/lib/google-sheet-mutation.ts`

## 12. Những điểm lệch hoặc nợ kỹ thuật đang thấy rõ

- Branding chưa thống nhất
  - package: `ctv-management`
  - README: `Team Management`
  - env app name: `Workdocker`
- `ArticlesPage.tsx` vẫn là component rất lớn
- `google-sheet-sync.ts` và `google-sheet-mutation.ts` là lõi phức tạp, nên tách nhỏ tiếp nếu còn mở rộng
- Tài liệu cũ ở root từng mô tả AI runtime, SQLite và single-file UI, không còn phản ánh đúng runtime hiện tại
- Build/lint trong workspace hiện tại chạy khá nặng, cần kiểm tra thêm khi làm thay đổi lớn
