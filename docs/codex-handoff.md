# Codex Handoff

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
