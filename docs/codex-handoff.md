# Codex Handoff

## Update 2026-03-26 (review registration shared sheet profile)

- `Đăng ký bài duyệt` không được khóa theo tên reviewer thật của bài.
- Reviewer thật vẫn dùng để phân quyền, lọc danh sách và lưu audit trong app.
- Cấu hình sheet đăng ký bài duyệt hiện dùng một profile mặc định chung tại:
  - `src/lib/review-registration.ts`
- Khi ghi xuống Google Sheet hoặc Apps Script:
  - luôn dùng `profile.reviewerLabel`
  - hiện tại là `Việt Nguyễn`
- Vì vậy reviewer như `Trung` vẫn phải đăng ký được bình thường nếu bài đó đang giao cho họ duyệt.

## Update 2026-03-26 (reviewer queue + sheet future-date guard)

- Reviewer view ở `ArticlesPage` không nên tách thành 2 section `Bài đã giao` và `Bài chờ nhận duyệt`.
- Hiện reviewer dùng một section chung `Danh sách bài duyệt`, nhưng từng dòng vẫn có badge:
  - `Đã bàn giao`
  - `Chờ nhận duyệt`
- Chọn hàng loạt chỉ áp dụng cho bài chưa có reviewer.
- Google Sheet sync đã thêm guard bỏ qua tab tháng/năm ở tương lai khi auto-pick.
- `refreshScopedArticlesFromGoogleSheet()` cũng bỏ qua `sheetMonth/sheetYear` tương lai từ sync link cũ và fallback về kỳ hợp lệ.
- `review-registration-browser-automation` khi suy năm cho block `Tháng X` giờ ưu tiên bám theo `articleDate` để tránh nhảy sai sang năm sau.

## Update 2026-03-25 (reviewer article registration)

- Đã thêm scaffold hoàn chỉnh cho luồng reviewer:
  - nút `Đã duyệt`
  - nút `Đăng ký bài duyệt`
- File chính:
  - `src/app/api/articles/route.ts`
  - `src/app/api/review-registrations/route.ts`
  - `src/lib/review-registration.ts`
  - `src/lib/review-registration-automation.ts`
  - `src/app/components/review-registration-ui.ts`
  - `src/app/components/ArticlesPage.tsx`
  - `src/app/components/MobileArticleCard.tsx`
  - `output/review-registration.workdocker.gs`
  - `docs/review-registration-automation.md`
- `GET /api/articles` hiện đã gắn thêm metadata đăng ký bài duyệt cho từng bài.
- `PUT /api/articles` có action `mark-reviewed` dành cho reviewer/admin.
- `POST /api/review-registrations` là endpoint xếp hàng ghi sheet bài duyệt.
- Sheet thật đã được phân tích theo cấu trúc:
  - tab `Việt Nguyễn`
  - block tháng mới nhất trong cùng tab
  - tìm dòng trống đầu tiên trong block
  - điền ngày, link, CTV viết, reviewer và tick toàn bộ checkbox.
- Runtime cần cấu hình:
- `REVIEW_REGISTRATION_SCRIPT_WEB_APP_URL`
- `REVIEW_REGISTRATION_SCRIPT_SECRET`
- Từ vòng sau, reviewer registration có thêm fallback browser-session:
  - `src/lib/review-registration-browser-automation.ts`
  - `scripts/save-review-registration-google-session.mjs`
  - env hỗ trợ:
    - `REVIEW_REGISTRATION_GOOGLE_STORAGE_STATE_PATH`
    - `REVIEW_REGISTRATION_GOOGLE_STORAGE_STATE_JSON`
    - `REVIEW_REGISTRATION_GOOGLE_STORAGE_STATE_BASE64`
- Thứ tự ưu tiên runtime:
  1. nếu có session Google đã lưu thì ghi sheet bằng browser automation
  2. nếu không có session thì fallback Apps Script
  3. nếu không có cả hai thì backend fail-fast và báo lỗi rõ bằng tiếng Việt

## Update 2026-03-25 (admin/team onboarding foundation)

- Da them gate onboarding cho admin/leader truoc khi vao `MainApp`:
  - admin neu chua co `employeeCode` se bi chan va vao `AdminSetupPage`
  - admin team neu chua co `teamId` se bi buoc dat ten nhom ngay lan dau
- File chinh:
  - `src/app/components/AdminSetupPage.tsx`
  - `src/app/api/admin/setup/route.ts`
  - `src/app/api/auth/me/route.ts`
  - `src/app/components/auth-context.tsx`
  - `src/app/components/AppRouter.tsx`
- `POST /api/admin/setup` da xu ly:
  - luu `employeeCode`
  - tao team moi neu admin team chua co team
  - cap nhat `teamId` cho user/collaborator lien ket
  - claim `ownerUserId` neu team chua co owner
- `PUT /api/teams` khong con chi danh rieng cho leader:
  - leader van co full team update + transfer owner
  - admin team duoc sua `name/description` cua dung team minh
- `TeamPage` da co nut cap nhat thong tin nhom hien tai cho admin team de bat dau van hanh de hon.

## Update 2026-03-25 (KPI Content retest gate)

- Khong coi fix KPI Content la hoan tat neu moi chi sua repo.
- Can chot du 3 lop:
  1. payload final POST khop browser payload that, trong do `submissionTimestamp = -1`
  2. production da redeploy sang commit moi
  3. KPI Content tables cu sai da duoc backup va xoa de UI gom batch lai sach
- Da xac dinh them mot nguyen nhan goc co kha nang cao:
  - direct-form flow truoc do chi lay `fbzx` tu `viewform` nhung khong mang theo cookie session sang `formResponse`
  - can forward lai cookie session nay de form backend xu ly day du 5 o link giong browser
- Da xac nhan live runtime tren VPS hien khong con `KPI_CONTENT_SCRIPT_*`, nen neu van sai thi uu tien nghi den payload direct-form hoac du lieu batch cu trong DB, khong do lai cho Apps Script proxy.

## Update 2026-03-25 (Coolify redeploy verification rule)

- Root cause cua viec "push code roi nhung production chua doi" la app tren Coolify dang o trang thai:
  - bat `is_auto_deploy_enabled = true`
  - nhung source la `Public GitHub`
  - khong co webhook hop le de tu tao deployment nhu Vercel
- Tu bay gio, phai coi redeploy la mot buoc rieng va bat buoc verify tren live.
- Tu bay gio, moi thay doi can duoc dua len GitHub, khong duoc de o local roi coi la da xong.
- Co che hien tai tren VPS:
  - `/usr/local/bin/ctv-management-coolify-queue.sh`
  - `/usr/local/bin/ctv-management-coolify-autodeploy.sh`
  - `systemd timer` moi `15 giay`
- Chi bao "da xong" khi du ca 4 buoc:
  1. commit da len `origin/main`
  2. deployment moi nhat trong Coolify da `finished`
  3. container live da doi sang commit moi
  4. URL production that da duoc mo lai va kiem tra

## Update 2026-03-25 (KPI Content response cleanup for old bad rows)

- Commit `bfd7b5d` da sua payload submit KPI Content cho cac request moi.
- Neu Looker Studio van hien du lieu sai sau deploy, uu tien nho rang day la response cu da ghi sai truoc do, khong phai app van submit sai tiep.
- Da bo sung cleanup tool rieng cho Google response sheet:
  - `output/kpi-content-response-cleanup.workdocker.gs`
  - `docs/kpi-content-response-cleanup.md`
- Cleanup tool mac dinh chi quet incident hien tai:
  - ngay `2026-03-25`
  - `employeeCode = NhanND18`
  - task/detail sai hoac loi ma hoa
  - va tat ca cot link deu trong
- Luon chay theo thu tu:
  - `previewSuspiciousKpiContentRows()`
  - `backupAndDeleteSuspiciousKpiContentRows()`
- Cleanup script se tao sheet backup trong cung spreadsheet truoc khi xoa dong goc.

## Update 2026-03-25 (KPI Content automation for admin/leader)

- Từ thời điểm này, toàn bộ thông báo UI/API mới phải dùng tiếng Việt có dấu đầy đủ.
- Không thêm chuỗi thông báo không dấu hoặc bị lỗi mã hóa.
- Da them luong `KPI Content` cho admin/leader:
  - `ArticlesPage` co nut `Dang ky KPI`
  - `Team` co luu `employeeCode` cho admin/leader
  - `KPI` co section quan ly batch KPI Content noi bo
- Da co Apps Script mau va env mau:
  - `output/kpi-content-automation.workdocker.gs`
  - `docs/kpi-content-automation.md`
  - `.env.example` co:
    - `KPI_CONTENT_SCRIPT_WEB_APP_URL`
    - `KPI_CONTENT_SCRIPT_SECRET`
- Mapping form KPI Content da chot:
  - page 1: `entry.2063490353`, `entry.1997176339`
  - page 2: `entry.1511448067`, `entry.1417839557`
  - page 3: `entry.1708619375`, `entry.115890814`, `entry.1057708020`, `entry.779972713`, `entry.1418536144`
- Batch KPI Content toi da `5` link.
- Logic chon field van theo `3` page, nhung final POST phai giong browser that:
  - nhanh `Viết bài tin tức` -> `pageHistory = 0,4,6`
  - nhanh `Mô tả sản phẩm` -> `pageHistory = 0,3,6`
  - `employeeCode`, `task`, `detail` phai nam trong `partialResponse`
  - final POST chi gui `partialResponse + pageHistory + fbzx + submissionTimestamp + 5 link`
- Backend `src/lib/kpi-content-automation.ts` gio co the submit truc tiep toi Google Form neu chua set `KPI_CONTENT_SCRIPT_WEB_APP_URL` va `KPI_CONTENT_SCRIPT_SECRET`.
- Apps Script KPI Content chi con la phuong an proxy du phong.
- Da verify truc tiep voi form that:
  - flow submit tung page rieng bi validation fail
  - flow submit mot request cuoi on dinh hon cho form nay
- Da verify production VPS sau commit `6857245`:
  - `GET /api/kpi-content` da lazy-init schema KPI Content tren DB production
  - DB da co `employee_code` trong `users`
  - admin `admin@ctvmanager.com` da duoc gan `NhanND18`
  - da tao 1 batch test that cho 5 bai `SEO AI` cua `Nhân BTV` va batch da `completed`

## Update 2026-03-25 (production copy tu Vercel/Nile da vao VPS)

- Da vao duoc Vercel CLI account va verify production that:
  - project `team-management`
  - domain `www.workdocker.com`
- Da pull env production tu Vercel ve file tam de doi chieu va sync sang Coolify.
- Da import DB production Nile vao PostgreSQL tren VPS thanh cong:
  - `articles = 9785`
  - `payments = 36`
  - `content_work_registrations = 46`
- Da xac dinh `GOOGLE_SHEETS_ARTICLE_SOURCE_URL` tu du lieu `article_sync_links` khi Vercel env khong co key nay.
- Da sync env production quan trong vao Coolify bang chinh model `EnvironmentVariable` cua Coolify (khong chot SQL plaintext nua vi gia tri env cua Coolify duoc encrypt).
- App tren VPS da redeploy thanh cong o commit `c8f34af039dce78d989c2196f0790652905366b5` va container moi da co day du:
  - `APP_ORIGIN` / `APP_ORIGINS`
  - `JWT_SECRET`
  - `GOOGLE_SHEETS_*`
  - `CONTENT_WORK_*`
  - `LINK_CHECK_AUTOMATION_TOKEN`
- Hien trang:
  - VPS/Coolify da co ban sao production day du code + env + data
  - domain/DNS chua duoc doi, nen Vercel van la ban public that
  - Apps Script / webhook / link-check runner chua repoint sang domain moi

## Update 2026-03-25 (xac nhan production that tren Vercel + Nile)

- Da verify production that hien tai dang nam o:
  - Vercel project `team-management`
  - scope `nhans-projects-1be8e712`
  - aliases `www.workdocker.com`, `workdocker.com`
- Da inventory env production qua Vercel CLI:
  - da pull env production vao file tam de doi chieu khi copy sang Coolify
  - khong duoc copy cac bien `VERCEL_*` sang runtime Coolify
- Da tao tai lieu cutover rieng:
  - `docs/vercel-nile-to-coolify-cutover.md`
- Da va script migration DB:
  - `scripts/migrate-neon-to-nile.mjs` gio cover them `content_work_registrations`, `kpi_monthly_targets`
  - preserve serial IDs that
  - reset target sequences
  - import trong transaction
- Truoc khi cat traffic that:
  - can domain + HTTPS
  - can repoint Apps Script / webhook / link-check runner
  - can import DB production Nile vao PostgreSQL VPS va doi chieu row counts

## Update 2026-03-25 (Coolify/VPS hardening before domain)

- Repo da them hardening cho production:
  - `request-security.ts` chi con trust `APP_ORIGIN` / `APP_ORIGINS` neu da cau hinh, khong tu them `Host` header vao allowlist nua.
  - `db/index.ts` fail-fast neu production thieu `DATABASE_URL`.
  - `auth/register` da bi khoa bang env `AUTH_REGISTER_ENABLED` va mac dinh production la tat.
  - `google-sync webhook` khong con fallback secret mac dinh, va production khong cho override `sourceUrl`.
  - `google-sheet-sync.ts` khong con fallback default sheet URL tren production neu chua set `GOOGLE_SHEETS_ARTICLE_SOURCE_URL`.
  - public `health` response da duoc toi gian hoa.
- Da them script/ops:
  - `npm run db:seed:admin-only`
  - `npm run db:prune-runtime-data`
  - `npm run db:prune-runtime-data:apply`
  - `scripts/db-backup-docker.sh`
  - `scripts/db-restore-docker.sh`
  - tai lieu `docs/coolify-vps-production.md`
- `scripts/db-bootstrap.mjs` da duoc nang schema/init gan hon voi runtime bootstrap version `9`.
- VPS/Coolify da duoc harden truc tiep:
  - backup snapshot truoc hardening: `/var/backups/ctv-management/postgres/pre-hardening-2026-03-24T18-06-10Z.dump`
  - da xoa collaborator demo va xoa het `audit_logs` / `realtime_events` test ban dau vi production chua co du lieu that
  - admin hien tai: `admin@workdocker.local`, `is_leader=true`, `team_id=1`, `collaborator_id=null`, `must_change_password=true`
  - da set env runtime trong Coolify: `DATABASE_BOOTSTRAP_MODE=skip`, `AUTH_REGISTER_ENABLED=false`
  - da xoa `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` khoi runtime env
  - da tao backup local hang ngay tren VPS:
    - script: `/usr/local/bin/ctv-management-db-backup.sh`
    - cron: `/etc/cron.d/ctv-management-db-backup`
    - backup test: `/var/backups/ctv-management/postgres/scheduled-2026-03-24T18-09-12Z.dump`
  - da chan cong khai `8080`, `6001`, `6002` bang `DOCKER-USER` iptables va luu qua `iptables-persistent`
- Chua lam:
  - chua gan domain/HTTPS
  - chua cau hinh bo `GOOGLE_SHEETS_*` va `CONTENT_WORK_*` thuc te cho production
  - chua co offsite backup (hien moi co local backup tren cung VPS)

## Update 2026-03-16 (Content Work automation nền bằng Apps Script chung)

- Đã thêm luồng `Content Work` mới cho `CTV`:
  - sau khi lưu bài mới trong `ArticlesPage`, hệ thống bật prompt `Đăng ký Content Work`
  - khi bấm, app tạo job trong DB và chạy nền
  - trạng thái hiển thị ở tab `Content Work`
- Không dùng đăng nhập Google riêng của từng CTV.
- Thiết kế chạy bằng `một tài khoản Google automation chung` thông qua Apps Script web app.

### File đã động vào

- `src/db/schema.ts`
- `src/db/index.ts`
- `src/app/api/content-work/route.ts`
- `src/lib/content-work-registration.ts`
- `src/lib/content-work-automation.ts`
- `src/app/components/ContentWorkPage.tsx`
- `src/app/components/MainApp.tsx`
- `src/app/components/ArticlesPage.tsx`
- `.env.example`
- `output/content-work-automation.workdocker.gs`
- `docs/content-work-automation.md`
- `docs/codex-handoff.md`

### Ghi chú vận hành

- Muốn tính năng chạy thật, bắt buộc deploy Apps Script ở:
  - `output/content-work-automation.workdocker.gs`
- Và set env:
  - `CONTENT_WORK_SCRIPT_WEB_APP_URL`
  - `CONTENT_WORK_SCRIPT_SECRET`
- Nếu chưa cấu hình Apps Script, app vẫn tạo job nhưng job sẽ rơi vào `failed` với thông báo rõ nguyên nhân.

## Update 2026-03-14 (Google Sheet mirror không chèn dòng giữa sheet nữa)

- Đã sửa Apps Script mẫu ở `output/google-sheets-webhook.workdocker.gs`.
- Root cause:
  - hàm `appendArticleRow_()` trước đó dùng `sheet.insertRowAfter(insertAfterRow)`
  - thao tác này chèn hẳn một dòng mới vào giữa sheet
  - vì sheet gốc có block KPI/nhuận ở bên phải, việc chèn dòng làm lệch toàn bộ dữ liệu ở các cột phải
- Logic mới:
  - tìm **hàng trống đầu tiên còn sẵn** trong toàn bộ vùng bảng bài viết
  - dùng lại hàng trống đó để ghi dữ liệu
  - chỉ copy format/data validation trong vùng cột bài viết
  - không đụng vào phần KPI/nhuận bên phải
  - nếu hết hàng trống thì **báo lỗi và dừng**, không tự thêm hàng mới
  - khi xóa bài chỉ clear dữ liệu vùng bài viết của dòng đó, không `delete row`

### File đã động vào

- `output/google-sheets-webhook.workdocker.gs`
- `docs/google-sheets-webhook.md`
- `docs/codex-handoff.md`

### Ghi chú vận hành

- Sau khi sửa file Apps Script mẫu trong repo, bắt buộc:
  - dán lại script vào Google Apps Script
  - lưu
  - redeploy web app
- Nếu không redeploy, Google Sheet vẫn chạy logic cũ có `insertRowAfter(...)`

## Update 2026-03-14 (ổn định link-check FPT Shop + tránh ghi đè `unknown`)

- Đã ghi postmortem chi tiết ở `docs/link-check-fpt-regression-2026-03-14.md`.
- Kết luận chính:
  - FPT Shop bot-block một phần request từ Vercel nên manual check không luôn xác minh được link
  - normalize soft-404 trước đó thiếu bước `đ -> d`, làm một số trang lỗi tiếng Việt bị lọt
  - manual check từng có thể ghi đè trạng thái đúng thành `unknown`
  - FPT Shop còn nhúng chuỗi lỗi 404 vào HTML của cả trang bài thật, nên rule quét toàn body có thể đánh `broken` oan hàng loạt
- Đã sửa theo 3 lớp:
  - GitHub Actions + Playwright Chromium là nhánh quét chính xác cho FPT Shop
  - backend/browser runner normalize đủ tiếng Việt và đọc HTML đầy đủ hơn
  - manual check không còn persist `unknown` để ghi đè trạng thái đã biết
  - soft-404 giờ ưu tiên `title + h1`, chỉ fallback xuống body khi trang không có tín hiệu bài viết rõ ràng
- UI `Kiểm tra link` giờ:
  - vẫn cho recheck ngay
  - nếu chưa xác minh chắc chắn thì chỉ báo `đang chờ xác minh nền`
  - không làm badge đúng bị chuyển sang sai

### Dữ liệu đã sửa trên DB hiện tại

- repair `35` dòng `unknown`
- kết quả:
  - `30` dòng `broken`
  - `5` dòng `ok`
- sau repair: `unknown = 0`

### File đã động vào

- `src/app/api/check-links/route.ts`
- `src/lib/link-health-browser.ts`
- `scripts/link-check-browser-runner.mjs`
- `.github/workflows/link-check-schedule.yml`
- `src/app/components/ArticlesPage.tsx`
- `docs/link-check-fpt-regression-2026-03-14.md`
- `docs/codex-handoff.md`

### Commit quan trọng

- `699cf42` Run scheduled FPT link checks in GitHub browser runner
- `74a7b82` Fix FPT soft-404 normalization in link checks
- `d7c8484` Avoid persisting manual unknown link states

### Kiểm tra đã chạy

- `npm run verify:safe` ✅
- browser thật xác minh:
  - `203074` = `broken`
  - `203076` = `ok`
- GitHub Actions manual run `Scheduled Link Check` ✅
- Khi chạm lại `check-links`, phải test thêm:
  - một link sống FPT Shop có chuỗi lỗi ẩn trong HTML
  - xác minh scheduled/browser runner không ra pattern bất thường kiểu `all broken`

## Update 2026-03-13 (ẩn tab Lịch biên tập của CTV khi chưa có task)

- `MainApp.tsx` giờ không còn render tab `Lịch biên tập` cố định cho mọi `CTV`.
- Logic mới:
  - `admin` luôn thấy tab `Lịch biên tập`
  - `CTV` chỉ thấy tab này khi `/api/editorial-tasks` trả về có task được giao cho đúng danh tính của họ
  - nếu đang ở tab `tasks` mà hệ thống xác định không còn task hiển thị, app sẽ tự quay về `dashboard`
- `BottomTabBar.tsx` cũng nhận `showTasksTab` để ẩn luôn tab mobile, tránh lệch giữa desktop và mobile
- `MainApp.tsx` refresh lại visibility của tab này khi:
  - vào app
  - quay lại tab đang xem
  - có realtime `tasks`, `notifications`, hoặc `team`
  - fallback polling chạy

### File đã động vào

- `src/app/components/MainApp.tsx`
- `src/app/components/BottomTabBar.tsx`
- `docs/codex-handoff.md`

### Kiểm tra đã chạy

- `npx eslint src/app/components/MainApp.tsx src/app/components/BottomTabBar.tsx` ✅
- `npm run typecheck` ✅

## Update 2026-03-13 (dashboard CTV self-scope + card auto layout)

- `DashboardPage.tsx` giờ dùng cache theo `viewerCacheKey`, tránh lẫn cache giữa admin và CTV khi đổi tài khoản trong cùng phiên.
- Dashboard cho `CTV` đã được siết lại theo đúng danh tính hiện tại:
  - block `Cộng tác viên` chỉ còn hiện dữ liệu của chính người đang đăng nhập
  - block `Danh mục` chỉ thống kê bài viết trong phạm vi cá nhân
  - `Hoạt động mới` không còn hiển thị cột tác giả dư thừa ở view cá nhân
- `statistics/route.ts` không còn dùng scope rộng theo collaborator directory cho CTV:
  - ưu tiên exact scope từ danh tính/alias của chính user
  - nếu cần fallback thì chỉ quét trong team hiện tại rồi fuzzy-match lại với owner candidates của chính user
- `globals.css` đã được chỉnh để grid card co giãn theo nội dung tốt hơn:
  - `dashboard-insight-grid`, `stats-grid`, `price-grid`, `royalty-overview-grid` dùng `align-items: start`
  - các lớp card chính (`card`, `glass-card`, `stat-card`, `price-card`, `breakdown-card`, `summary-card`) dùng `height: auto; min-height: 0`

### File đã động vào

- `src/app/components/DashboardPage.tsx`
- `src/app/api/statistics/route.ts`
- `src/app/globals.css`
- `docs/codex-handoff.md`

### Kiểm tra đã chạy

- `npx eslint src/app/components/DashboardPage.tsx src/app/api/statistics/route.ts` ✅
- `npm run typecheck` ✅
- `npm run verify:safe` ✅

## Update 2026-03-13 (chuyển bài viết sang tháng sau + popup đăng ký lại)

- Thêm action mới `move-to-next-month` trong `PUT /api/articles`.
- Luồng mới chỉ áp dụng cho bài của `CTV`:
  - admin mở modal `Chỉnh sửa bài viết`
  - bấm `Chuyển sang tháng sau`
  - hệ thống tự đổi `date` sang tháng kế tiếp và ép `status = NeedsFix`
  - tạo notification `system` cho đúng tài khoản CTV với tiêu đề `Đăng ký lại bài trong Content Work`
- `MainApp.tsx` giờ sẽ tự bật popup cho `CTV` khi có unread reminder này:
  - nút `Đến trang đăng ký` mở form Content Work
  - nút `Đã đăng ký` sẽ mark notification là read
- Cố ý **không** đẩy mutation này ngược sang Google Sheet cũ ở bước move month:
  - lý do: nguồn gốc đăng ký tháng mới phải đi từ Content Work form
  - nếu tự đẩy ngược row cũ sang workbook ở đây rất dễ làm sai tháng hoặc sai nguồn row
  - audit log đã ghi rõ note này trong action `article_moved_to_next_month`

### File đã động vào

- `src/lib/content-work-registration.ts`
- `src/app/api/articles/route.ts`
- `src/app/components/ArticlesPage.tsx`
- `src/app/components/MainApp.tsx`
- `docs/codex-handoff.md`

### Kiểm tra đã chạy

- `npx eslint src/app/components/ArticlesPage.tsx src/app/components/MainApp.tsx src/app/api/articles/route.ts src/lib/content-work-registration.ts` ✅
- `npm run typecheck` ✅

## Update 2026-03-13 (CTV mở tab Bài viết lần đầu bị trống)

- Đã sửa `ArticlesPage.tsx` để lần mở đầu của `CTV` không còn mặc định áp bộ lọc `tháng/năm hiện tại`.
- Logic mới:
  - `admin` vẫn dùng default filter theo tháng hiện tại
  - `CTV` mặc định dùng filter rỗng để thấy bài mới nhất ngay khi mở tab
  - initial fetch chờ `authLoading` hoàn tất rồi mới chạy, tránh dựng request đầu tiên bằng state chưa ổn định
  - `clearFilters()` cũng quay về default theo vai trò thay vì luôn ép `tháng hiện tại`

### File đã động vào

- `src/app/components/ArticlesPage.tsx`
- `docs/codex-handoff.md`

### Kiểm tra đã chạy

- `npx eslint src/app/components/ArticlesPage.tsx` ✅
- `npm run typecheck` ✅

## Update 2026-03-13 (auto-fill article ID from link + chặn lưu thiếu link)

- Thêm helper dùng chung `src/lib/article-link-id.ts` để trích `6` chữ số ID ở cuối URL bài viết.
- `ArticlesPage.tsx` giờ:
  - tự điền `Mã ID hệ thống` khi dán link bài viết
  - làm mờ ô ID và không cho CTV nhập tay
  - hiển thị note `Mã ID tự tạo khi có link bài viết`
  - chặn CTV lưu bài mới nếu chưa có link hoặc link không có đủ `6` chữ số ID cuối URL
- `POST/PUT /api/articles` cũng dùng cùng helper để:
  - tự đồng bộ `articleId` từ `link`
  - chặn lưu bài mới của CTV nếu thiếu link hợp lệ
  - từ chối link mới không có `6` chữ số ID ở cuối đường dẫn

### File đã động vào

- `src/lib/article-link-id.ts`
- `src/app/components/ArticlesPage.tsx`
- `src/app/api/articles/route.ts`
- `docs/codex-handoff.md`

### Kiểm tra đã chạy

- `npx eslint src/app/components/ArticlesPage.tsx src/app/api/articles/route.ts src/lib/article-link-id.ts` ✅
- `npm run typecheck` ✅
- `npm run verify:safe` ✅
- `npx tsx -e "...extractArticleIdFromLink(...)"` ✅

## Update 2026-03-13 (postmortem lỗi lọc bài viết + guardrail publish)

- Đã ghi lại postmortem đầy đủ ở `docs/article-filter-regression-2026-03-13.md`.
- Kết luận quan trọng:
  - không có chuyện admin thật sự mất quyền trong DB
  - regression đến từ 2 lớp:
    - alias/role inference làm bài admin bị gắn nhãn `CTV`
    - split view `CTV` / `Biên tập/Admin` tính từ page hiện tại thay vì toàn tập lọc của tháng
- Đã thêm guardrail vào `AGENTS.md` để các thread sau:
  - đọc postmortem này khi chạm `Bài viết`
  - không suy ra editorial bucket từ collaborator role một mình
  - bắt buộc test case `Tháng 1 / 2026 / Tất cả bút danh`
- Đã thêm script `scripts/publish-safe.ps1` để tránh lỗi vận hành:
  - `OPS-CODEX-GIT-RACE-001`
  - nghĩa là `git commit` và `git push` bị chạy song song nên push hụt commit mới

### File đã động vào

- `docs/article-filter-regression-2026-03-13.md`
- `AGENTS.md`
- `scripts/publish-safe.ps1`
- `docs/codex-handoff.md`

### Kiểm tra đã chạy

- `npm run verify:safe` ✅

## Update 2026-03-13 (fix lệch SEO 1K5 + nhuận bút)

- Đã sửa lệch nghiệp vụ `SEO ICT/Gia dụng 1K5`:
  - trước đó code đang hiểu `1K5` theo `1000-1500`, làm nhiều bài `1500-2000` bị giữ ở type thường thay vì `1K5`
  - điều này kéo sai lookup rate trong `royalty` và `payments`
- Đã gom luật canonicalization vào `resolveAppArticleFields()` trong `src/lib/google-sheet-article-mapping.ts` và dùng chung cho:
  - import/sync từ Google Sheets
  - create/update article
  - royalty dashboard/calculate
  - payment generation
  - mirror ngược ra Google Sheets
- `Articles API` cũng đã được tăng độ chắc trong phần phân loại `CTV` / `Biên tập/Admin` bằng fallback identity matching theo team khi exact pen name không khớp.
- Thêm script `scripts/repair-seo-classification.mjs`:
  - dry-run mặc định
  - `--apply` để sửa dữ liệu thật
  - mặc định chỉ refresh `payments.status = pending` đã tồn tại
  - nếu muốn sinh nốt payment thiếu thì chạy thêm `--create-missing-pending`

### Dữ liệu đã sửa trên DB hiện tại

- Đã chạy `node scripts/repair-seo-classification.mjs --apply`
- Kết quả:
  - sửa `767` bài SEO `ICT/Gia dụng` bị lệch `articleType` / `wordCountRange`
  - refresh `7` payment `pending`
  - check lại sau sửa: `articleFixCount = 0`
- Đã chạy tiếp `node scripts/repair-seo-classification.mjs --apply --create-missing-pending`
  - tạo thêm `18` payment `pending` còn thiếu
  - check lại sau đó: `missingPendingCalculationCount = 0`

### Ghi chú vận hành

- Script đã có 2 mức an toàn rõ ràng:
  - `--apply`: sửa classification + refresh pending đang có
  - `--apply --create-missing-pending`: tạo thêm pending còn thiếu khi thật sự muốn đồng bộ đủ sổ payment
- Sau khi chạy đủ 2 bước trên DB hiện tại, phần payment thiếu đã được lấp đầy.

### File đã động vào

- `src/lib/google-sheet-article-mapping.ts`
- `src/app/api/articles/route.ts`
- `src/app/api/royalty/route.ts`
- `src/app/api/payments/route.ts`
- `scripts/repair-seo-classification.mjs`
- `package.json`
- `docs/optimization-memory.md`
- `docs/codex-handoff.md`

### Kiểm tra đã chạy

- `npm run verify:safe` ✅
- `node scripts/repair-seo-classification.mjs` ✅
- `node scripts/repair-seo-classification.mjs --apply` ✅
- `node scripts/repair-seo-classification.mjs --apply --create-missing-pending` ✅

## Update 2026-03-13 (phase 2 refactor an toàn cho Google Sheets sync)

- `src/lib/google-sheet-sync.ts` đã được gom bớt logic chuẩn bị trùng lặp để giảm rủi ro lệch hành vi giữa các entrypoint sync:
  - helper resolve `sourceUrl`
  - helper normalize `identityCandidates`
  - helper nạp `collaboratorPenNames + collaboratorDirectory`
  - helper dựng/reuse `sharedState`
- Refactor này không đổi thứ tự match hiện tại và không đụng vào guard xóa batch đã thêm trước đó.
- Mục tiêu là giảm chi phí bảo trì cho các vòng tối ưu tiếp theo, đồng thời giữ an toàn cho push GitHub và redeploy Vercel.

### File đã động vào

- `src/lib/google-sheet-sync.ts`
- `docs/optimization-memory.md`
- `docs/codex-handoff.md`

### Kiểm tra đã chạy

- `npm run verify:safe` ✅

## Update 2026-03-13 (tooling nhẹ hơn + sync guard + deploy hygiene)

- Thu hẹp phạm vi lint/typecheck để không quét lan toàn repo:
  - `lint` giờ chỉ quét `src`, `scripts`, và các file config chính, đồng thời bật `.eslintcache`
  - `tsconfig.json` bỏ `allowJs`, bỏ `.next/dev/types`, và exclude thêm `.agent`, `.vercel`, `docs`, `logs`, `output`, `tmp`, `data`
- Thêm `typecheck` script riêng và giữ `verify:safe = lint + typecheck`.
- Tăng hygiene cho repo/deploy:
  - `.gitignore` thêm `.agent/`, `.rune/`, `coverage/`, `.eslintcache`, `rune.config.local.json`
  - thêm `.vercelignore` để local/CLI deploy không đẩy theo docs, logs, output, tmp, generated AI context
  - `next.config.ts` thêm `serverExternalPackages` cho `bcryptjs`, `pg`, `xlsx`
  - CI thêm `concurrency`, cache `.next/cache` + Playwright, và dùng `npm run verify:safe`
- Gia cố Google Sheets sync nhưng vẫn giữ đồng bộ liên tục:
  - thêm guard chặn xóa hàng loạt đáng ngờ trong `executeGoogleSheetSync`
  - guard sẽ chặn nếu số bài định xóa vượt ngưỡng env hoặc nếu sheet đang phải dùng fallback date
  - `refreshScopedArticlesFromGoogleSheet` giờ tải workbook Google Sheets một lần rồi reuse cho toàn bộ group trong request, thay vì tải lặp lại theo từng group
  - env mới trong `.env.example`:
    - `GOOGLE_SHEETS_SYNC_MAX_DELETE_COUNT`
    - `GOOGLE_SHEETS_SYNC_MAX_DELETE_RATIO`
  - `POST /api/articles/google-sync` và webhook đều được thêm `dynamic = "force-dynamic"` + `maxDuration = 60` để chạy ổn định hơn trên Vercel
- `ArticlesPage.tsx` thêm `AbortController` để hủy request danh sách bài cũ khi người dùng lọc/search/paginate nhanh, tránh request chồng và state cập nhật lệch
- Tạo `docs/optimization-memory.md` làm bộ nhớ tối ưu hóa lâu dài; `AGENTS.md` giờ trỏ rõ vào tài liệu này để các thread sau không lặp lại cùng vòng tối ưu
- `google-sheet-sync.ts` được tối ưu thêm theo hướng giảm latency chuẩn bị:
  - scoped sync tải workbook một lần rồi reuse cho toàn bộ group
  - các bước DB/network độc lập trong `refreshScopedArticlesFromGoogleSheet`, `executeGoogleSheetSync`, `executeGoogleSheetWorkbookSync` được chạy song song bằng `Promise.all`
- `ArticlesPage.tsx` được tối ưu thêm phần link-health polling:
  - dùng `linkHealthRef` để tránh effect kiểm tra link chạy lại chỉ vì `linkHealth` vừa đổi
- Dọn local AI config không cần commit:
  - xóa `rune.config.json`
  - thêm ignore để worktree sạch hơn

### File đã động vào

- `.env.example`
- `.gitignore`
- `.github/workflows/ci.yml`
- `.vercelignore`
- `docs/codex-handoff.md`
- `docs/optimization-memory.md`
- `AGENTS.md`
- `eslint.config.mjs`
- `next.config.ts`
- `package.json`
- `.gitignore`
- `src/app/api/articles/google-sync/route.ts`
- `src/app/api/articles/google-sync/webhook/route.ts`
- `src/app/components/ArticlesPage.tsx`
- `src/lib/google-sheet-sync.ts`
- `tsconfig.json`

### Kiểm tra đã chạy

- `npm run lint` ✅
- `npm run typecheck` ✅
- `npm run verify:safe` ✅
- `npm run build` ⏳ chưa hoàn tất được trên máy local hiện tại dù đã tăng timeout lên hơn 7 phút; nhiều khả năng vẫn bị ảnh hưởng bởi môi trường workspace trên ổ `J:` hơn là lỗi TypeScript/lint

## Update 2026-03-12 (repo hygiene + safe verification)

- Removed tracked stale build artifacts and OneDrive conflict copies from the repo so GitHub/Vercel stops receiving backup noise.
- Tightened `.gitignore` to keep `.next_stale_build`, Codex logs, `*.bak`, and `*-DESKTOP-*` files out of future commits.
- Tightened `eslint.config.mjs` ignores so local lint does not scan stale build output, temp folders, or generated artifacts.
- Added `npm run verify:safe` for a no-database baseline check: lint + `tsc --noEmit`.
- Added optional `DATABASE_BOOTSTRAP_MODE=skip` so stable production environments can skip runtime schema bootstrap queries; `/api/health` still performs a lightweight DB ping in that mode.
- After moving the repo to `J:`, verified that the drive is `exFAT`; `next build` with Turbopack can fail there because it cannot create Windows junction points for `node_modules`.
- Added `npm run build:compat` (`next build --webpack`) as an extra option, but left full builds separate because both Turbopack and webpack can still hit `exFAT` filesystem limitations on Windows.
- Added `npm run verify:full` for environments where full production build verification is available.
- Baseline checks on this machine:
  - `npm run lint` passes after ignore cleanup
  - `npx tsc --noEmit --pretty false` passes
  - `npm run build` passes
  - `npm run test:smoke` still requires a reachable PostgreSQL instance and currently fails locally with `ECONNREFUSED 127.0.0.1:5432`
  - a later `npm run build` rerun inside the OneDrive workspace hit `EPERM ... .next\\static\\...` during unlink, which points to a local file-lock/sync issue rather than a TypeScript or Next.js compile failure

## Current status

- Repo commit history is aligned with `origin/main`.
- There is an existing unstaged user change in `src/lib/google-sheet-sync.ts`; keep it intact while doing repo optimization.
- Next recommended pass: review runtime/database hotspots before broader refactors that might affect Nile quota usage.
- Workspace move checklist for leaving OneDrive is documented in `docs/workspace-move-checklist.md`.

## Update 2026-03-12

- Đã nhận bộ biến môi trường Nile và chuyển `.env.local` sang dùng Nile thay vì Neon.
- Runtime và tooling đã hiểu thêm các biến:
  - `DATABASE_POSTGRES_URL`
  - `DATABASE_NILEDB_URL`
  - `DATABASE_NILEDB_POSTGRES_URL` + `DATABASE_NILEDB_USER` + `DATABASE_NILEDB_PASSWORD`
- `src/lib/runtime-diagnostics.ts` cũng đã hiểu bộ biến Nile; health/runtime error message không còn giả định chỉ có `DATABASE_URL`.
- Đã migrate dữ liệu local từ `data/ctv-management.db` sang Nile `ctv_management`.
- Nile không hỗ trợ `TRUNCATE ... CASCADE`, `setval`, `nextval`, và một số `ALTER TABLE` kiểu Postgres chuẩn, nên script migrate đã được đổi sang:
  - import theo lô nhỏ
  - để Nile tự sinh `id`
  - remap lại foreign keys cho `users`, `collaborators`, `articles`, `notifications`, `comments`, `payments`, `feedback`, `audit_logs`
  - chạy `postImportNormalize` riêng để tạo `Team mặc định` và backfill `team_id`
- Trạng thái DB Nile sau migrate:
  - `teams=1`
  - `collaborators=10`
  - `users=2`
  - `articles=256`
  - `article_comments=9`
  - `editorial_tasks=12`
  - `royalty_rates=18`
  - `payments=9`
  - `notifications=4`
  - `monthly_budgets=1`
  - `audit_logs=173`
  - `realtime_events=72`
  - `app_runtime_meta=1`
- So với SQLite nguồn:
  - các bảng nghiệp vụ chính đã khớp số lượng
  - `audit_logs` và `realtime_events` trên Nile cao hơn `+2`, do đã phát sinh thêm `login_failed/login_success` và 2 event `audit` mới ngay sau migrate, không phải mất dữ liệu
- Vẫn còn một snapshot local cũ ở `.vercel/.env.production.local` đang chứa Neon; đây chỉ là file pull từ Vercel CLI, không phải source of truth. Nếu cần đồng bộ local với dashboard hiện tại, chạy lại `vercel env pull`.
- Kiểm tra integrity sau migrate:
  - `users_without_team=0`
  - `collaborators_without_team=0`
  - `articles_without_team=0`
  - không có orphan ở `article_comments -> articles/users`
  - không có orphan ở `notifications -> users/articles`

- Rà lại nguồn dữ liệu sau khi rời Neon để chuẩn bị chuyển sang Nile.
- `scripts/migrate-neon-to-nile.mjs` đã được viết lại thành migrate tổng quát:
  - nhận source từ `SOURCE_DATABASE_URL` / `NEON_DATABASE_URL`
  - hoặc `SOURCE_SQLITE_PATH`
  - hoặc `SOURCE_JSON_PATH`
  - nhận target từ `TARGET_DATABASE_URL` / `NILE_DATABASE_URL`
  - với Postgres thường có thể giữ `id`; với Nile sẽ để DB tự sinh `id`, remap foreign key, rồi backfill team scope tối thiểu
- `scripts/db-bootstrap.mjs` đã được nâng lên khớp schema hiện tại (`teams`, `feedback_entries`, `app_runtime_meta`, team-scoped columns, `review_link`, `is_leader`).
- Đã thêm script npm: `npm run db:migrate-nile`.
- Guardrail mới: nếu `DATABASE_URL` vẫn đang là Neon mà chưa set `TARGET_DATABASE_URL` hoặc `NILE_DATABASE_URL`, script sẽ dừng ngay thay vì ghi nhầm vào DB cũ.
- Kiểm tra nguồn dữ liệu còn lại:
  - `.env.local` hiện đã đổi sang Nile; `.vercel/.env.production.local` vẫn là snapshot local Neon cũ
  - kết nối Neon hiện lỗi `password authentication failed`
  - `data/ctv-management.db` hiện có dữ liệu local lớn nhất còn truy cập được: `users=2`, `collaborators=10`, `articles=256`, `article_comments=9`, `editorial_tasks=12`, `royalty_rates=18`, `payments=9`, `notifications=4`, `audit_logs=171`, `realtime_events=70`
  - `output/backups/ctv-management-before-article-reset-2026-03-07T09-07-35-451Z.db` là bản backup cũ hơn
  - chưa tìm thấy connection string Nile trong workspace hoặc các thư mục backup cũ

- Google Sheet sync khong con tu suy luan `Published` khi cot trang thai de trong.
- Import sheet cung khong con tu suy `articleId` tu slug link neu o `ID bai viet` trong sheet dang trong.
- Da reconcile production DB bang logic sync moi de keo du lieu web ve dung theo sheet goc.
- Da kiem tra lai 5 bai SEO AI / Dinh Nhan o `Thang 022026` tung hien sai `Da duyet`; hien tai tat ca da ve `Draft`, `reviewer = null`, `article_id = null` va giu `link` theo sheet.

## Trạng thái hiện tại

- Stack chính: `Next.js App Router` + `TypeScript` + `Drizzle ORM` + `PostgreSQL`.
- Mô hình phân quyền hiện tại: `leader -> admin team -> writer/reviewer -> ctv account`.
- Scope dữ liệu đã đi theo `teamId` ở các module chính; leader xem toàn hệ thống, admin team bị giới hạn trong team của mình.
- Nghiệp vụ nhạy cảm nhất vẫn là đồng bộ bài viết hai chiều với Google Sheets.
- Luồng xóa `web -> Google Sheet` đang là `non-blocking`: web xóa thành công trước, nếu sync sheet lỗi thì chỉ ghi warning vào audit log và trả cảnh báo.
- `RoyaltyPage` hiện tính ngân sách CTV chỉ theo bài của collaborator role `writer`; không tính bài của `reviewer` hoặc tài khoản `admin`.
- Repo đã có tài liệu định vị tốt hơn:
  - `AGENTS.md`
  - `docs/codex-thread-safety.md`
  - `docs/project-map.md`

## Thay đổi quan trọng gần nhất

Ngày cập nhật: `2026-03-11`

### Phiên khuya 6 - 11/03

**Mục tiêu:** Sửa lỗi `Đồng bộ ngay` không ổn định với bài của `Biên tập/Admin`, nhất là trường hợp sync xong chỉ còn thấy khi đang lọc theo tháng rồi bỏ lọc thì bài biến mất.

#### Đã hoàn thành

- Bổ sung scope sync theo team đúng ngữ cảnh:
  - `leader` vẫn sync toàn hệ thống
  - `admin team` chỉ sync các pen name trong team của mình
  - `writer` chỉ sync trong phạm vi team + identity của chính họ
- Sửa backend Google Sheet sync để khi import bài từ sheet:
  - cố gắng resolve `teamId` từ collaborator pen name
  - lưu `teamId` vào bài mới ngay lúc insert
  - giữ shared sync state theo đúng team/scope hiện tại
- Thêm backfill bootstrap cho dữ liệu cũ có `articles.team_id IS NULL`:
  - ưu tiên map theo `collaborators.pen_name -> team_id` nếu pen name chỉ thuộc một team
  - fallback theo `users.team_id` của `created_by_user_id`
  - cuối cùng mới đẩy về `Team mặc định`
- Đổi thứ tự danh sách bài viết sang `updatedAt DESC` trước `date DESC` để bài vừa sync từ tháng cũ vẫn nổi lên đầu danh sách khi bỏ lọc.
- Bổ sung nhánh tự sửa dữ liệu khi sync gặp bài cũ đã match nhưng còn thiếu `teamId`.
- Sửa tiếp màn `Bài viết` cho layout tách nhóm:
  - split view không còn chia từ `1 page` dữ liệu chung
  - `GET /api/articles?splitView=true` trả về toàn bộ tập dữ liệu đã lọc trong scope hiện tại
  - ẩn phân trang đáy ở split view để tránh nhóm `Biên tập/Admin` bị rỗng giả khi trang đầu chỉ toàn bài CTV
- Sửa thêm lõi đồng bộ Google Sheet cho bài CTV:
  - canonical hóa tab `Bản sao của Tháng ...` về tab chuẩn cùng tháng/năm khi import/sync
  - workbook sync chỉ reconcile `preferred tabs`, không cho tab copy ghi đè ngược trạng thái
  - nếu cột trạng thái bị trống nhưng sheet đã có `link` và `người duyệt` hoặc `articleId`, hệ thống sẽ suy luận `Published` thay vì rơi về `Draft`

#### File đã động vào

- `src/app/api/articles/google-sync/route.ts`
- `src/app/api/articles/route.ts`
- `src/app/components/ArticlesPage.tsx`
- `src/db/index.ts`
- `src/lib/google-sheet-sync.ts`

#### Kiểm tra đã chạy

- `npx eslint src/lib/google-sheet-sync.ts src/app/api/articles/google-sync/route.ts src/app/api/articles/route.ts src/app/components/ArticlesPage.tsx src/db/index.ts` ✅
- `npx tsc --noEmit --pretty false` ✅
- `npm run build` ✅

### Phiên khuya 5 - 11/03

**Mục tiêu:** Chia giao diện `Bài viết` thành 2 khu quản lý riêng cho `CTV` và `Biên tập/Admin` nhưng vẫn dùng chung nguồn dữ liệu + Google Sheet gốc.

#### Đã hoàn thành

- Mở rộng response của `GET /api/articles` để mỗi bài có thêm metadata phân loại tác giả:
  - `authorBucket`: `ctv | editorial`
  - `authorBucketLabel`
  - `authorRole`
  - `authorUserRole`
- Backend phân loại theo collaborator/team/link user:
  - `writer` => `CTV`
  - `reviewer` hoặc collaborator được gắn `admin` => `Biên tập/Admin`
  - fallback theo `createdByUserId` nếu không map được collaborator
- `ArticlesPage.tsx` đã chuyển từ 1 bảng dài sang layout 2 khối:
  - `Bài của CTV`
  - `Bài của Biên tập/Admin`
- Thêm summary cards ở đầu danh sách bài viết để nhìn nhanh:
  - tổng bài trên trang hiện tại
  - số bài của CTV
  - số bài của Biên tập/Admin
- Trong bảng, cột `Bút danh` đã có badge hiển thị nhóm tác giả ngay trên từng dòng.
- Filter `Bút danh` ở admin không còn chỉ lấy `writer`; giờ lấy tất cả pen name trong team để quét được cả bài của biên tập/admin.

#### File đã động vào

- `src/app/api/articles/route.ts`
- `src/app/components/ArticlesPage.tsx`
- `src/app/components/types.ts`

#### Kiểm tra đã chạy

- `npx eslint src/app/api/articles/route.ts src/app/components/ArticlesPage.tsx src/app/components/types.ts` ✅
- `npx tsc --noEmit --pretty false` ✅
- `npm run build` ✅

### Phiên khuya 4 - 11/03

**Mục tiêu:** Dọn microcopy giải thích thừa trên giao diện hệ thống.

#### Đã hoàn thành

- Gỡ các dòng mô tả phụ dưới tiêu đề trang ở các màn chính:
  - `ArticlesPage`
  - `AuditLogsPage`
  - `EditorialTasksPage`
  - `FeedbackPage`
  - `NotificationsPage`
  - `RoyaltyPage`
  - `TeamPage`
- Dọn thêm các helper text không cần thiết trong:
  - `DashboardPage` (subtitle + banner giải thích nhuận bút)
  - `RoyaltyPage` (ghi chú kỳ đang xem + ghi chú scope biểu đồ)
  - `FeedbackPage` (mô tả phụ ở form và danh sách)
  - `TeamPage` (mô tả phụ ở thẻ thông tin team)
- Giữ nguyên các cảnh báo thao tác, thông tin lỗi, trạng thái dữ liệu tạm tính và các hướng dẫn có tính an toàn vận hành.

#### Kiểm tra đã chạy

- `npm run lint` ✅
  - Còn 2 warning từ `.next_stale_build/*`
- `npx tsc --noEmit --pretty false` ✅
- `npm run build` ✅

### Phiên tối 3 - 11/03

**Mục tiêu:** Chuẩn bị bản mới để push GitHub và redeploy Vercel.

#### Đã hoàn thành

- Cài `git` trên máy local để có thể commit/push trực tiếp.
- Đồng bộ local với `origin/main` và gộp commit team-management mới nhất từ remote.
- Xử lý conflict ở:
  - `src/app/components/TeamPage.tsx`
  - `docs/codex-handoff.md`

#### Kiểm tra đã chạy

- `npm run build` ✅
- `npm run lint` ✅
  - Còn warning từ `.next_stale_build/*`
- `npx tsc --noEmit --pretty false` ✅

### Phiên tối 2 - 11/03

**Mục tiêu:** Điều chỉnh logic Nhuận bút theo ngân sách CTV và bổ sung biểu đồ cân bằng `Viết mới / Viết lại`.

#### Đã hoàn thành

- Sửa backend `royalty` và `payments` để chỉ tính bài của `writer` vào ngân sách CTV.
- Loại bài của `reviewer` hoặc tài khoản `admin` khỏi:
  - dashboard ngân sách
  - top writers
  - royalty calculation
  - payment generation và payment listing
- Thêm `contentBalance` vào dashboard:
  - số bài `Viết mới`
  - số bài `Viết lại`
  - tỷ lệ phần trăm
  - mức chênh lệch
  - cờ cảnh báo lệch từ `10%`
- Cập nhật `RoyaltyPage.tsx`:
  - thêm biểu đồ tròn `Viết mới / Viết lại`
  - admin chỉ thấy tổng bài của CTV writer trong scope team
  - CTV chỉ thấy bài của chính mình
  - thêm cảnh báo trực quan trong UI
  - thêm popup `alert` khi lệch vượt ngưỡng

#### File đã động vào

- `src/lib/royalty.ts`
- `src/app/api/royalty/route.ts`
- `src/app/api/payments/route.ts`
- `src/app/components/RoyaltyPage.tsx`
- `src/app/components/types.ts`

### Phiên tối - 11/03

**Mục tiêu:** Bổ sung tài liệu định vị hệ thống và cập nhật lại overview cũ.

#### Đã hoàn thành

- Tạo `docs/project-map.md`:
  - cấu trúc thư mục
  - module nghiệp vụ
  - bảng dữ liệu
  - phân quyền
  - luồng dữ liệu chính
  - script và CI
- Cập nhật `../project_overview.md` ở root workspace để bỏ mô tả cũ lệch runtime hiện tại.

### Phiên chiều và khuya - 11/03

**Những thay đổi nền quan trọng đang có trong repo**

- Nâng app từ `admin toàn cục` sang `leader + team admin`.
- Thêm bảng `teams`, `users.isLeader`, `users.teamId`, và backfill dữ liệu legacy vào `Team mặc định`.
- Thêm API `GET/POST/PUT /api/teams` cho leader tạo team và bàn giao owner.
- `TeamPage.tsx` có selector team cho leader, modal tạo team, modal bàn giao owner, và roster theo team.
- Vá bootstrap/login:
  - tách tạo index `team_id` sau bước tạo cột
  - reset `initializationPromise` nếu bootstrap fail để request sau có thể retry
- Thêm chẩn đoán DB ở:
  - `src/lib/runtime-diagnostics.ts`
  - `src/app/api/health/route.ts`

## Việc còn cần nhớ

- **Redeploy Apps Script**:
  - file `output/google-sheets-webhook.workdocker.gs` đã có handler `deleteArticle`
  - cần deploy lại trên Google để thay đổi có hiệu lực
- `findMatchingCollaboratorPenNames` vẫn còn fallback full scan; nếu dữ liệu lớn hơn nên cân nhắc `pg_trgm` hoặc `unaccent`.
- `ArticlesPage.tsx` và `google-sheet-sync.ts` vẫn là hai điểm phức tạp lớn nhất của codebase.
- Branding hiện còn chưa thống nhất:
  - package: `ctv-management`
  - README: `Team Management`
  - app name env: `Workdocker`
- Bootstrap schema version hiện tại trong code là `6`.

## File nên mở đầu tiên

- `AGENTS.md`
- `docs/codex-thread-safety.md`
- `docs/project-map.md`
- `src/db/schema.ts`
- `src/db/index.ts`
- `src/lib/teams.ts`
- `src/app/api/teams/route.ts`
- `src/app/components/TeamPage.tsx`
- `src/app/api/articles/route.ts`
- `src/lib/google-sheet-sync.ts`
- `src/lib/google-sheet-mutation.ts`
- `src/app/components/ArticlesPage.tsx`
- `output/google-sheets-webhook.workdocker.gs`

## Khu vực không nên quét bừa

- `.next`
- `node_modules`
- `logs`
- `output` trừ khi đang làm Apps Script hoặc file export
- `data` nếu task không liên quan import/export

## Lệnh kiểm tra chuẩn

```bash
npm run lint
npm run build
```

## Mẫu handoff cho thread sau

```md
## Trạng thái
- Đang làm:
- Đã xong:

## File đã động vào
- path/to/file

## Việc tiếp theo
- ...

## Kiểm tra đã chạy
- npm run lint
- npm run build

## Rủi ro / ghi chú
- ...
```

## Trạng thái
- Đã xong: siết bố cục bảng `Bài viết` để cụm `Link / Thao tác` không bị trôi ra ngoài ở desktop.
- Chưa làm: chưa đụng vào scope dashboard cho CTV; giữ nguyên nguyên tắc chỉ hiện dữ liệu đúng danh tính đang đăng nhập.

## File đã động vào
- `src/app/components/ArticlesPage.tsx`

## Việc tiếp theo
- Nếu vẫn còn một viewport hẹp nào phải kéo ngang, giảm tiếp `articleTableMinWidth` hoặc cố định thêm chiều rộng `Loại bài / Trạng thái`.
- Khi quay lại dashboard, chỉ chỉnh layout card co giãn, không mở rộng dữ liệu CTV sang tên người khác.

## Kiểm tra đã chạy
- `npx eslint src/app/components/ArticlesPage.tsx`
- `npm run typecheck`

## Rủi ro / ghi chú
- Bản vá hiện dùng `tableLayout: fixed` và thu cột `Ngày`, `Người duyệt`, `Link`; nếu sau này badge hoặc text trong các cột này bị nới lại, cụm thao tác có thể lại trôi ra mép phải.

## Update 2026-03-26 (Reviewer queue và future sheet dates)
- Reviewer UI phải gom thành 1 danh sách duyệt chung; nếu production còn hiện 2 khối thì live chưa ăn đúng bundle mới hoặc đang cache bản cũ.
- Nguồn Google Sheet hiện thực sự có 19 dòng xuất ra ngày `2027-09-27` và `2027-09-28` trong các tab `Tháng 092025` / `Tháng 102025`.
- Đã thêm guard trong sync để tự sửa lại năm theo năm của tab sheet trước khi ghi DB, thay vì tin nguyên văn ngày tương lai từ source row.
- Đã thêm script `scripts/repair-future-sheet-dates.mjs` để sửa các `articles.date` sai năm đã tồn tại sẵn trong DB.



### Ghi chú thêm 2026-03-16

- GitHub Actions runner hiện trả `403` cho cả canary sống `203076` và canary chết `203074`.
- `scripts/link-check-browser-runner.mjs` đã thêm canary guard.
- Nếu runner không phân biệt đúng 2 link mẫu này, workflow sẽ `skip` an toàn thay vì persist sai hàng loạt.
- Cron GitHub cho `Scheduled Link Check` đã tắt.
- Runner định kỳ chính đã chuyển sang local Windows task:
  - `scripts/run-link-check-local.ps1`
  - `scripts/register-link-check-scheduled-task.ps1`
  - tài liệu: `docs/link-check-local-runner.md`
