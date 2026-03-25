# Optimization Memory

## 2026-03-25 - Reviewer article registration memory

- Reviewer flow mới không đi qua Google Form.
- Luồng đúng là:
  1. reviewer đánh dấu `Đã duyệt`
  2. reviewer bấm `Đăng ký bài duyệt`
  3. backend queue `review_registrations`
  4. Apps Script ghi trực tiếp vào Google Sheet
- Sheet thật đã được chốt cấu trúc:
  - spreadsheet `157reP9SMWXgV47XHPcUJNqo1RicwS6vsqQvOlEW5F8Q`
  - tab `Việt Nguyễn`
  - block tháng mới nhất nằm trong cùng tab, không phải tab riêng
  - dòng hợp lệ để ghi là dòng đầu tiên có `Link` và `CTV Viết` còn trống
  - cột cần ghi:
    - A ngày
    - B link
    - C CTV viết
    - D reviewer
    - F -> L checkbox = `TRUE`
- Metadata trạng thái đăng ký bài duyệt phải được gắn trực tiếp vào `/api/articles`, không fetch rời ở client.
- Không nên lặp lại:
  - không dùng generic article update cho reviewer mark reviewed
  - không nhét logic ghi sheet reviewer vào `articles` route
  - trước đây không tạo flow browser-login Google mới; từ 2026-03-26 reviewer registration đã có browser-session fallback có kiểm soát
- Browser-session reviewer registration dùng:
  - `scripts/save-review-registration-google-session.mjs` để lấy `storageState`
  - `REVIEW_REGISTRATION_GOOGLE_STORAGE_STATE_PATH` hoặc `...JSON` hoặc `...BASE64`
  - public CSV export để xác định đúng dòng trước và xác minh lại sau khi ghi
- Thứ tự runtime đúng hiện tại:
  1. ưu tiên browser-session nếu có session Google editor
  2. fallback Apps Script nếu đã cấu hình
  3. thiếu cả hai thì fail-fast

## 2026-03-25 - Admin/team onboarding foundation

- Da bo sung gate onboarding rieng cho admin/leader:
  - `src/app/components/AdminSetupPage.tsx`
  - `src/app/api/admin/setup/route.ts`
  - `src/app/components/AppRouter.tsx`
  - `src/app/api/auth/me/route.ts`
  - `src/app/components/auth-context.tsx`
- Quy uoc hien tai:
  - admin/leader phai co `employeeCode`
  - admin team (khong phai leader) neu chua co `teamId` thi bi buoc dat ten nhom ngay lan vao dau
  - onboarding xong moi vao `MainApp`
- `POST /api/admin/setup` hien tai se:
  - luu `employeeCode`
  - tao team moi cho admin team neu chua co
  - cap nhat `teamId` cho user/collaborator lien ket
  - tu gan `ownerUserId` neu team chua co owner
- `PUT /api/teams` da mo them cho admin team:
  - duoc cap nhat `name/description` cua chinh team minh
  - khong duoc `transfer-owner`
  - khong duoc doi `status`
- `TeamPage` da co luong cap nhat nhanh thong tin nhom hien tai de admin team thao tac de hon.
- Khong nen lap lai:
  - khong dua admin team vao `MainApp` khi chua co `employeeCode`
  - khong bat admin team nhay vao `TeamPage` roi tu do moi "doan" can phai tao team
  - khong cap quyen sua moi team cho admin team; chi cho sua team scoped cua minh

## 2026-03-25 - KPI Content retest memory

- Live runtime da duoc xac nhan khong con `KPI_CONTENT_SCRIPT_*`, nen production dang di nhanh submit truc tiep toi Google Form.
- Browser payload that cua form KPI Content can:
  - `pageHistory` dung nhanh that cua form
  - `employeeCode`, `task`, `detail` nam trong `partialResponse`
  - `submissionTimestamp = -1`
- Google Form nay con tra ve cookie session tu `viewform`.
- Neu backend chi lay `fbzx` roi POST thang len `formResponse` ma khong forward lai cookie session, co the Google chi ghi nhan mot phan du lieu trang cuoi.
- Da gap mot nguyen nhan van hanh bo sung:
  - cac batch `completed` cu bi submit sai trong DB lam UI chi gom duoc it bai hop le hon cho lan gui tiep theo, co the con 1 bai
- Truoc khi retest that sau dot fix payload, can:
  1. backup KPI Content tables
  2. xoa sach `kpi_content_registration_batches` va `kpi_content_registrations` cu sai
  3. roi moi test lai tren production

## 2026-03-25 - Coolify redeploy memory

- Coolify tren VPS nay khong co trai nghiem `push la deploy ngay` giong Vercel neu chi dung `Public GitHub` ma khong co webhook trigger hop le.
- `is_auto_deploy_enabled = true` khong du de dam bao production tu doi commit.
- Da dat co che nhanh hon de tranh nghen test:
  - queue script: `/usr/local/bin/ctv-management-coolify-queue.sh`
  - poller wrapper: `/usr/local/bin/ctv-management-coolify-autodeploy.sh`
  - `systemd timer` moi `15 giay`
- Da verify that:
  - deployment `17` auto queue va `finished`
  - container live da len commit `949092c2f8bf3bc05dba35c944dabd02c4ef7c4c`
- Khong nen lap lai:
  - khong de thay doi chi nam o local ma chua push GitHub
  - khong bao da sua live neu moi chi push code
  - khong coi repo state la production state
  - khong bat nguoi dung test truoc khi deployment `finished` va live URL da duoc mo lai

## 2026-03-25 - KPI Content response cleanup memory

- Commit `bfd7b5d` da fix payload submit KPI Content cho cac luot gui moi.
- Cac dong response bi loi truoc do trong Google Form/Looker Studio khong tu mat di sau khi deploy code fix.
- Da bo sung cleanup tool rieng:
  - `output/kpi-content-response-cleanup.workdocker.gs`
  - `docs/kpi-content-response-cleanup.md`
- Cleanup tool nay mac dinh target incident:
  - `targetDatePrefixes = 2026-03-25`
  - `employeeCodes = [NhanND18]`
  - chi match dong co `task/detail` sai hoac loi ma hoa va dong thoi tat ca cot link deu trong
- Quy trinh an toan phai la:
  - preview
  - backup sang sheet rieng
  - roi moi delete
- Khong nen lap lai:
  - khong xoa tay tung dong response khi chua co backup
  - khong ket luan dashboard van loi logic moi neu chi con sot lai response cu bi submit sai

## 2026-03-25 - KPI Content automation memory

- Toàn bộ thông báo mới ở UI/API phải dùng tiếng Việt có dấu đầy đủ.
- Không thêm chuỗi thông báo không dấu hoặc bị lỗi mã hóa kiểu `Khong`, `Dang`, `â€¢`, `KhÃ...`.
- Khi sửa flow KPI Content hoặc auth, cần rà lại cả `toast`, `error`, `statusLabel`, `automationMessage` để tránh sót chuỗi không dấu.
- KPI Content da duoc bo sung cho admin/leader, khong danh cho CTV.
- Dang ky KPI Content gom toi da `5` bai cung nhom.
- Logic map field van theo `3` page cua Google Form, nhung submit that can gui bang `1 final POST` day du field bat buoc thay vi `3` request pageHistory rieng.
- Payload cuoi cua KPI Content phai giong browser submit that:
  - `Viết bài tin tức` -> `pageHistory = 0,4,6`
  - `Mô tả sản phẩm` -> `pageHistory = 0,3,6`
  - `employeeCode`, `task`, `detail` phai nam trong `partialResponse`, khong gui thang o request cuoi
- Backend app hien co the submit truc tiep Google Form neu chua cau hinh `KPI_CONTENT_SCRIPT_*`.
- Apps Script KPI Content tro thanh phuong an proxy du phong, khong con la dependency bat buoc de chay flow co ban.
- Da verify truc tiep voi form that:
  - submit tung page rieng de bi `data-validation-failed`
  - submit mot request cuoi voi day du `employeeCode + task + detail + 5 links + pageHistory=0,1,2` thi on dinh hon
- Da verify production tren `workdocker.com` sau khi deploy commit `6857245`:
  - hit `GET /api/kpi-content` da tu khoi tao schema KPI Content tren DB khi `DATABASE_BOOTSTRAP_MODE=skip`
  - DB production da co `users.employee_code`, `kpi_content_registration_batches`, `kpi_content_registrations`
  - admin `admin@ctvmanager.com` da duoc gan `employee_code = NhanND18`
  - da tao 1 batch that gom 5 bai editorial SEO AI va batch da ve `completed`
- Apps Script mau va env mau da co san:
  - `output/kpi-content-automation.workdocker.gs`
  - `.env.example` co `KPI_CONTENT_SCRIPT_WEB_APP_URL` va `KPI_CONTENT_SCRIPT_SECRET`
- Khong nen lap lai:
  - khong chay KPI Content bang luong CTV Content Work
  - khong submit qua 5 link trong mot batch
  - khong quay lai flow submit `3` request pageHistory cho form nay
  - khong quay lai `pageHistory = 0,1,2`
  - khong gui top-level `entry.2063490353`, `entry.1997176339`, `entry.1511448067`, `entry.1417839557` trong final POST
  - khong coi `KPI_CONTENT_SCRIPT_*` la bat buoc neu nhu cau chi la submit Google Form
  - khong doi mapping form neu chua cap nhat lai Apps Script mau va docs

## 2026-03-25 - Production copy memory

- Da copy DB production that tu Nile sang PostgreSQL tren VPS thanh cong.
- Da verify row counts dich:
  - `articles = 9785`
  - `payments = 36`
  - `content_work_registrations = 46`
- Da xac dinh mot bai hoc quan trong voi Coolify:
  - khong upsert `environment_variables` bang SQL plaintext neu muon app nhan env dung
  - phai dung model `App\\Models\\EnvironmentVariable` de value duoc encrypt dung chuan
- Da redeploy app sau khi sync env bang model va container moi da nhan day du env production quan trong.
- Khong nen lap lai:
  - khong dung SQL thuan de ghi secret env vao bang `environment_variables`
  - khong coi VPS la production live neu chua doi domain/DNS va repoint webhook

## 2026-03-25 - Coolify HTTP login memory

- Ban VPS/Coolify test bang `http://IP` co the dang login that thanh cong o backend nhung giao dien van dung im neu auth cookie bi set `Secure`.
- Auth cookie can duoc quyet dinh theo request protocol thuc te (`x-forwarded-proto` / URL) thay vi mac dinh `NODE_ENV=production`.
- Da harden frontend auth flow de neu request login/register loi mang thi phai hien error thay vi im lang.
- Khong nen lap lai:
  - khong ep `Secure` cho cookie auth khi ban staging van duoc truy cap qua `http://IP`
  - khong bo qua truong hop frontend bat fetch loi ma khong surface error cho user

## 2026-03-25 - Vercel/Nile cutover memory

- Production that da duoc xac nhan tren:
  - Vercel project `team-management`
  - domain `www.workdocker.com`
- Da co tai lieu runbook:
  - `docs/vercel-nile-to-coolify-cutover.md`
- Script migration DB da duoc nang cap de phuc vu cutover:
  - them `content_work_registrations`
  - them `kpi_monthly_targets`
  - preserve serial IDs that thay vi tao id moi
  - reset sequence sau import
  - chay import trong transaction
- Khong nen lap lai:
  - khong dung ban cu cua `scripts/migrate-neon-to-nile.mjs` cho production cutover
  - khong coi cutover la xong neu chua repoint Apps Script / webhook / link-check
  - khong doi `APP_ORIGIN` sang IP/HTTP de cho nguoi dung that dang nhap lau dai

## 2026-03-25 - Production hardening memory

- Production hardening da them cho `Coolify/VPS`:
  - `same-origin` tren production chi nen dua vao `APP_ORIGIN` / `APP_ORIGINS`
  - production phai fail-fast neu thieu `DATABASE_URL`
  - `AUTH_REGISTER_ENABLED` mac dinh nen de `false`
  - `GOOGLE_SHEETS_WEBHOOK_SECRET` va `GOOGLE_SHEETS_ARTICLE_SOURCE_URL` khong con fallback an danh tren production
  - sau khi DB init xong, dat `DATABASE_BOOTSTRAP_MODE=skip`
- Seed strategy da doi:
  - `npm run db:seed` = dev/demo flow
  - `npm run db:seed:admin-only` = production init flow cho DB trong
  - khong giu `SEED_ADMIN_*` trong runtime env sau khi tao admin
- Ops scripts da co san:
  - `scripts/db-backup-docker.sh`
  - `scripts/db-restore-docker.sh`
  - `scripts/prune-runtime-data.mjs`
  - doc van hanh: `docs/coolify-vps-production.md`
- Tren VPS hien tai da ap:
  - local daily backup
  - block cong public `8080`, `6001`, `6002`
  - clean demo collaborators va runtime noise ban dau
  - app dang chay voi `DATABASE_BOOTSTRAP_MODE=skip`
- Khong nen lap lai:
  - khong mo lai `SEED_ADMIN_*` cho runtime app
  - khong bat lai `AUTH_REGISTER_ENABLED` tru khi thuc su muon mo luong self-activation
  - khong de production sync vao default Google Sheet URL

Ngày cập nhật: `2026-03-13`

Tài liệu này là bộ nhớ tối ưu hóa của dự án. Mục tiêu là để các thread sau không lặp lại cùng một vòng "tối ưu lại từ đầu" nếu các thay đổi này vẫn còn hiệu lực.

## 1. Những tối ưu đã làm

### 1.1. Tooling và build hygiene

- `package.json`
  - thêm `typecheck`
  - `verify:safe = lint + typecheck`
  - `lint` chỉ quét `src`, `scripts` và các file config chính
  - bật `eslint --cache --cache-location .eslintcache`
- `tsconfig.json`
  - bỏ `allowJs`
  - thu hẹp `include`
  - exclude thêm `.agent`, `.vercel`, `docs`, `logs`, `output`, `tmp`, `data`
- `eslint.config.mjs`
  - ignore thêm các thư mục generated hoặc không thuộc code runtime
- `next.config.ts`
  - thêm `serverExternalPackages: ["bcryptjs", "pg", "xlsx"]`
- `.gitignore`
  - ignore thêm `.agent`, `.rune`, `.eslintcache`, `coverage`
- `.vercelignore`
  - loại trừ docs, logs, output, tmp và AI/generated context khỏi local deploy
- `.github/workflows/ci.yml`
  - thêm `concurrency`
  - cache `.next/cache`
  - cache Playwright browsers
  - chuyển sang `npm run verify:safe`

### 1.2. Runtime/client

- `ArticlesPage.tsx`
  - thêm `AbortController` để hủy request cũ khi search/filter/pagination đổi nhanh
  - giảm số lần effect kiểm tra `check-links` chạy lại bằng cách dùng `linkHealthRef` thay vì phụ thuộc trực tiếp vào `linkHealth` trong dependency array
  - dùng `ARTICLE_PAGE_SIZE` nhất quán hơn
  - tách constants/helpers sang `src/app/components/articles-page-config.ts`

### 1.3. Google Sheets sync

- `src/lib/google-sheet-sync.ts`
  - thêm guard chặn delete batch đáng ngờ khi reconcile từ sheet về app
  - guard dựa trên:
    - `GOOGLE_SHEETS_SYNC_MAX_DELETE_COUNT`
    - `GOOGLE_SHEETS_SYNC_MAX_DELETE_RATIO`
    - số dòng đang phải dùng fallback date
  - `refreshScopedArticlesFromGoogleSheet()` giờ tải workbook một lần rồi reuse cho toàn bộ group trong cùng request
  - song song hóa các bước chuẩn bị độc lập bằng `Promise.all` trong:
    - `refreshScopedArticlesFromGoogleSheet()`
    - `executeGoogleSheetSync()`
    - `executeGoogleSheetWorkbookSync()`
  - gom các bước chuẩn bị dùng chung thành helper riêng:
    - resolve `sourceUrl` chuẩn từ env/input
    - normalize `identityCandidates`
    - nạp `collaboratorPenNames + collaboratorDirectory`
    - dựng hoặc tái sử dụng `sharedState`
  - mục tiêu của lớp refactor này là giảm logic copy-paste giữa `sheet sync` và `workbook sync`, để các thay đổi sau không bị lệch hành vi giữa hai luồng
- `src/app/api/articles/google-sync/route.ts`
  - thêm `dynamic = "force-dynamic"`
  - thêm `maxDuration = 60`
- `src/app/api/articles/google-sync/webhook/route.ts`
  - thêm `dynamic = "force-dynamic"`
  - thêm `maxDuration = 60`
- `.env.example`
  - thêm biến guard cho delete trong sync

### 1.4. SEO classification + royalty accuracy

- `src/lib/google-sheet-article-mapping.ts`
  - chuẩn hóa lại cách hiểu `1K5` thành nhóm độ dài `1500-2000`, không còn map sang `1000-1500`
  - ưu tiên tín hiệu đặc thù từ `articleType` (`1K5`, `2K`) khi suy ra `wordCountRange`
  - gom logic canonicalization vào `resolveAppArticleFields()` để cùng một luật được dùng ở import sheet, create/update article, royalty, payments, và mirror ngược ra Google Sheets
- `src/app/api/articles/route.ts`
  - create/update article giờ canonicalize lại `category`, `articleType`, `contentType`, `wordCountRange` trước khi lưu
  - enrich article rows có fallback identity matching theo team để giảm lệch bucket `CTV` / `Biên tập/Admin` khi bút danh có biến thể
- `src/app/api/royalty/route.ts`
  - dashboard và calculate dùng phân loại canonical trước khi lookup rate
- `src/app/api/payments/route.ts`
  - generate payments dùng phân loại canonical trước khi tính `details` và `totalAmount`
- `scripts/repair-seo-classification.mjs`
  - script repair an toàn cho dữ liệu production/local
  - chuẩn hóa lại bài SEO `ICT/Gia dụng` theo `articleType + wordCountRange`
  - mặc định chỉ refresh các `payments.status = pending` đã tồn tại
  - chỉ khi truyền thêm `--create-missing-pending` mới tạo thêm payment `pending` còn thiếu
  - npm shortcut mới:
    - `npm run db:repair-seo-classification`
    - `npm run db:repair-seo-classification:create-missing`

- Đã chạy repair trên DB hiện tại ngày `2026-03-13`:
  - sửa `767` bài bị lệch `articleType` / `wordCountRange`
  - refresh `7` payment `pending` đang tồn tại
  - sau đó chạy thêm chế độ tạo missing pending và đã tạo `18` payment `pending` còn thiếu
  - sau khi chạy lại dry-run, `articleFixCount = 0` và `missingPendingCalculationCount = 0`

## 2. Vì sao không nên làm lại các tối ưu này

- Các tối ưu tooling ở trên đã giảm quét dư và tăng tốc vòng `lint/typecheck`.
- Guard trong Google Sheets sync không tắt đồng bộ; nó chỉ chặn các ca xóa có tín hiệu bất thường.
- Việc reuse workbook trong scoped sync đã loại bỏ một nguồn tải lặp rõ ràng khi đồng bộ nhiều bài thuộc nhiều tab.
- Việc gom helper chuẩn bị sync giúp giữ cùng một cách resolve scope/source/shared state giữa các entrypoint, nên không cần lặp lại refactor này trừ khi luồng sync đổi kiến trúc.
- Tách constants/helpers khỏi `ArticlesPage.tsx` giúp giảm tải nhận thức và giảm độ phình của file nóng nhất phía client.
- Phần chuẩn hóa SEO `1K5/2K` đã được gom vào một helper trung tâm; không nên vá riêng lẻ ở từng route nữa vì sẽ rất dễ làm lệch lại cách tính nhuận bút.

## 3. Khi nào mới nên xem xét tối ưu lại

Chỉ revisit nếu có ít nhất một trong các dấu hiệu sau:

- `npm run verify:safe` tăng thời gian rõ rệt sau một loạt thay đổi mới
- `ArticlesPage.tsx` lại phình thêm mạnh hoặc xuất hiện lag khi filter/search liên tục
- Google Sheets sync bắt đầu timeout hoặc load workbook nhiều lần sau khi đổi luồng
- Vercel deploy lại bắt đầu mang theo file rác hoặc generated artifacts
- CI bắt đầu có queue/cancel issues hoặc cache không còn hit hiệu quả

## 4. Những việc đã cân nhắc nhưng chưa làm

- Chưa tách hoàn toàn `ArticlesPage.tsx` thành nhiều component con hoặc custom hooks
  - vì cần refactor cẩn thận để tránh chạm quá nhiều state nghiệp vụ cùng lúc
- Chưa tách lớn `google-sheet-sync.ts` thành nhiều file phase-based
  - vì đây là lõi nhạy cảm, nên ưu tiên tối ưu có kiểm soát trước
- Chưa chốt được benchmark build production sạch trên máy local hiện tại
  - build vẫn bị ảnh hưởng bởi môi trường workspace/ổ đĩa hơn là lỗi TypeScript/lint

## 5. Baseline sau tối ưu

Đã xác nhận:

- `npm run lint` pass
- `npm run typecheck` pass
- `npm run verify:safe` pass

Repo hygiene hiện tại:

- `rune.config.json` đã được loại khỏi local working tree và thêm vào `.gitignore`

Lưu ý:

- `npm run build` chưa được xác nhận ổn định tuyệt đối trên workspace local hiện tại, nên đừng dùng máy local này làm benchmark cuối cùng cho build performance.

## 6. Nếu tiếp tục tối ưu ở các thread sau

Thứ tự ưu tiên nên là:

1. Tách `ArticlesPage.tsx` thành hooks + section components
2. Tách `google-sheet-sync.ts` theo phase:
   - workbook loading
   - row identity matching
   - reconcile/update
   - deletion guard
3. Benchmark build ở môi trường sạch hơn hoặc trên CI/Vercel thay vì chỉ dựa vào máy local hiện tại

## 7. File tham chiếu bắt buộc trước khi tối ưu tiếp

- `docs/optimization-memory.md`
- `docs/codex-handoff.md`
- `AGENTS.md`

## 8. Ghi nhớ vận hành 2026-03-25

- Dashboard trang chủ:
  - danh sách cộng tác viên nổi bật của khối admin không được lấy all-time
  - phải tính theo tháng mới nhất đang có bài viết trong dữ liệu
  - logic này hiện nằm ở `src/app/api/statistics/route.ts`
- Quyền leader:
  - hệ thống cho phép nhiều leader cùng lúc
  - thao tác cấp/gỡ leader được thực hiện ngay tại bảng `Admin team` trong `src/app/components/TeamPage.tsx`
  - backend nhận cập nhật qua `PUT /api/collaborators` với `userId + isLeader`
  - luôn phải giữ lại tối thiểu 1 leader
- Bút danh admin/leader:
  - không được giả định admin nào cũng đã có `collaboratorId`
  - trang `Hồ sơ cá nhân` phải cho phép tự sửa `họ tên + bút danh`
  - nếu tài khoản chưa có hồ sơ cộng tác viên, `PUT /api/profile` sẽ tự tạo hồ sơ nền rồi mới đồng bộ bút danh
