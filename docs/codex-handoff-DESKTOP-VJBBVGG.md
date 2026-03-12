# Codex Handoff

## Trạng thái hiện tại

- Stack chính: `Next.js App Router` + `TypeScript` + `Drizzle ORM` + `PostgreSQL`.
- Phân quyền đã được mở rộng sang mô hình `leader -> team admin -> writer/reviewer`.
- Dữ liệu lõi đã có `teams`, `users.isLeader`, và `teamId` cho các bảng chính để scope theo team.
- Leader xem và bàn giao mọi team; admin thường chỉ thấy dữ liệu thuộc team của mình; audit log và cập nhật ngân sách toàn cục là leader-only.
- Nghiệp vụ nhạy cảm nhất hiện tại là đồng bộ bài viết hai chiều với Google Sheet.
- Luồng xóa `web -> Google Sheet` giờ là **non-blocking**: bài xóa trên web luôn thành công, nếu Google Sheet sync thất bại thì chỉ ghi warning vào audit log và trả về response.
- Luồng phân quyền bài viết đã được chỉnh lại theo mô hình `admin` / `reviewer` / `writer`; reviewer giờ xem được hàng chờ duyệt và bài đã nhận duyệt.
- Tính năng "Duyệt lỗi" đã được gom vào luồng **Bình luận** duy nhất — chỉ còn 1 entry point cho phản hồi bài viết.
- Repo đã có `AGENTS.md` và bộ tài liệu Codex để giảm nguy cơ kẹt thread do context quá dài.

## Thay đổi quan trọng gần nhất

Ngày cập nhật: `2026-03-11` (phiên chiều 2)

### Phiên sáng — 12/03

**Mục tiêu:** Giảm cảm giác lag khi mở tab quản lý bài viết.

#### Kết luận nhanh
- DB hiện chưa phải nút thắt chính cho màn hình list bài viết:
  - `articles` ~ `9,623` dòng
  - query list cơ bản và `count(*)` chỉ mất mức vài ms ở DB
- Điểm gây chậm cảm nhận nhiều hơn nằm ở phía client:
  - `ArticlesPage.tsx` là client component lớn nhất repo (~146 KB source)
  - tab bài viết mở ra sẽ gọi thêm `GET /api/collaborators?view=directory` ngay cả khi user chưa mở filter/form
  - effect kiểm tra link published bắn request nền sớm, dễ tranh tài nguyên với lần render đầu

#### Đã làm
- `src/app/components/ArticlesPage.tsx`
  - bỏ fetch danh bạ cộng tác viên ở initial load
  - chỉ nạp danh bạ khi admin thật sự mở bộ lọc, mở form bài viết, hoặc mở tool xóa
  - dùng `useDeferredValue` + `requestIdleCallback`/timer fallback để dời link-check sang lúc browser rảnh
  - giới hạn mỗi đợt link-check còn `10` URL để tránh dồn request nền
  - tách `ArticleDeleteModal` thành lazy chunk riêng, không còn parse toàn bộ tool xóa ngay khi vừa mở tab bài viết
- `src/app/components/ArticleDeleteModal.tsx`
  - component mới chứa toàn bộ UI của tool xóa dữ liệu, chỉ load khi user mở modal
- `src/app/api/articles/route.ts`
  - đổi `GET /api/articles` từ `select()` toàn bảng sang select đúng các cột màn hình đang dùng
  - tái sử dụng cùng một shape cho list và single-row load để giảm payload/JSON parse

#### Kiểm tra đã chạy
- `npm run lint` ✅
  - còn 2 warning cũ từ `.next_stale_build/*`
- `npm run build` ✅

#### Việc còn dở / bước nên làm tiếp nếu vẫn thấy chậm
- Nếu cảm giác lag vẫn rõ trên máy yếu, ưu tiên tách tiếp `ArticlesPage` thành các chunk động riêng cho:
  - modal import
  - modal xóa dữ liệu
  - modal bình luận
  - modal tạo/sửa bài
- Nếu dữ liệu bài viết tiếp tục tăng mạnh, có thể cân nhắc thêm index composite phục vụ `ORDER BY date DESC, updated_at DESC, id DESC`

### Phiên chiều 2 — 11/03 (đang thực hiện)

### Phiên tối — 11/03

**Mục tiêu:** Nâng app từ `admin toàn cục` sang `leader + team admin`, kèm UI quản lý team và bàn giao owner.

#### Đã hoàn thành
- **Schema + bootstrap migration**:
  - Thêm bảng `teams`
  - Thêm `users.isLeader`, `users.teamId`
  - Thêm `teamId` cho `collaborators`, `articles`, `editorial_tasks`, `kpi_records`, `payments`, `feedback_entries`
  - Bootstrap schema version tăng lên `5`
  - Dữ liệu cũ được backfill vào `Team mặc định`; admin cũ được đánh dấu `isLeader = true`
- **Auth + team context**:
  - JWT / `/api/auth/*` trả thêm `isLeader`, `teamId`, `team`
  - Thêm helper `src/lib/teams.ts` để resolve scope và check quyền team
- **Scope lại API theo team**:
  - `collaborators`, `statistics`, `search`, `export`
  - `editorial-tasks` + reminders
  - `payments`, `royalty`, `feedback`, `notifications`
  - `articles/comments`, `articles/review`
  - `audit-logs` chuyển thành leader-only
- **API team mới**:
  - `GET /api/teams`: leader xem tất cả, team admin chỉ xem team của mình
  - `POST /api/teams`: leader tạo team và có thể tạo luôn owner admin
  - `PUT /api/teams` với `action = transfer-owner`: leader bàn giao owner cho tài khoản khác trong team
- **UI quản trị**:
  - `MainApp.tsx` phân biệt `LEADER HỆ THỐNG` và `ADMIN TEAM`
  - `TeamPage.tsx` có selector team cho leader, modal tạo team, modal bàn giao owner, và roster scope theo team đang chọn
  - `RoyaltyPage.tsx` chỉ cho leader chỉnh ngân sách toàn cục
- **Seed/dev data**:
  - Seed mặc định tạo `team` đầu tiên và admin seed là leader

#### Kiểm tra đã chạy
- `npm run lint` ✅
  - Còn 2 warning từ `.next_stale_build/*` chứ không phải mã nguồn app
- `npm run build` ✅

### Phiên khuya — 11/03

**Mục tiêu:** Chẩn đoán lỗi không đăng nhập được sau khi user báo màn hình login trả "Hệ thống đang gặp lỗi".

#### Kết luận
- `auth/login` đang rơi vào nhánh `500`, không phải sai email/mật khẩu.
- Nguyên nhân môi trường local: [.env.local] chỉ còn cấu hình sai kiểu cũ `DATABASE_URL=file:...` trong khi app hiện chỉ dùng PostgreSQL/Neon.
- Máy local không có PostgreSQL ở `127.0.0.1:5432`, Vercel CLI cũng chưa được đăng nhập, repo không có `.vercel`, nên chưa thể tự kéo env production về máy.
- Sau khi nối lại Neon, phát hiện **nguyên nhân gốc của lỗi login trên DB thật** là bootstrap migration `v5` bị lỗi thứ tự:
  - code tạo index `team_id` trước khi `ALTER TABLE ... ADD COLUMN team_id`
  - trên DB cũ `bootstrap_schema_version = 4`, request login đầu tiên sẽ crash trong `ensureDatabaseInitialized()`
  - promise lỗi lại bị cache trong `initializationPromise`, nên app tiếp tục fail cho tới khi restart/redeploy

#### Đã làm
- Dọn lại [.env.local] theo format local hiện tại:
  - tạo `JWT_SECRET` local hợp lệ
  - thêm `APP_ORIGIN=http://localhost:3000`
  - bỏ `DATABASE_URL=file:...`
  - sau đó đã gắn `DATABASE_URL` Neon thật vào local env
- Thêm chẩn đoán cấu hình DB trong:
  - `src/lib/runtime-diagnostics.ts`
  - `src/app/api/health/route.ts`
- `/api/health` giờ sẽ báo rõ:
  - thiếu `DATABASE_URL`
  - `DATABASE_URL` đang là SQLite/file URL
  - `DATABASE_URL` sai format PostgreSQL
- Đã test kết nối driver `pg` tới Neon thành công (`select current_database()` trả về `neondb`)
- Đã vá code:
  - `src/db/index.ts`: tách index `team_id` ra chạy sau `ensureColumnExists`
  - `src/db/index.ts`: reset `initializationPromise` về `null` nếu bootstrap fail để request sau có thể retry
- Đã chạy migration cứu hộ trực tiếp trên Neon:
  - thêm `users.is_leader`, `users.team_id`
  - thêm `team_id` cho các bảng liên quan
  - tạo/backfill `Team mặc định`
  - set `bootstrap_schema_version = 5`
- Đã kiểm tra account `khaidinh.seo@gmail.com`:
  - user tồn tại
  - có `password_hash`
  - `bcrypt.compare` hoạt động bình thường với hash hiện tại

#### Việc còn dở
- Restart app local hoặc redeploy để xóa instance đang giữ cache lỗi bootstrap cũ, rồi test lại login

### Phiên khuya 2 — 11/03

**Mục tiêu:** Chỉnh brand block ở sidebar để title/subtitle không tràn khỏi sidebar khi role/team name dài.

#### Đã làm
- `src/app/components/BrandLogo.tsx`
  - thêm `layout="sidebar"` để logo biết khi nào đang render trong sidebar
  - subtitle ở sidebar giờ tự xuống dòng, giảm letter-spacing và clamp tối đa 2 dòng
  - container/text wrapper có `minWidth: 0` để flex shrink đúng, không bị tràn ngang
- `src/app/components/MainApp.tsx`
  - sidebar dùng `layout="sidebar"` cho block logo

#### Kiểm tra đã chạy
- `npm run lint` ✅
  - còn 2 warning từ `.next_stale_build/*`
- `npm run build` ✅

**Mục tiêu:** Rebuild CMS Browser Panel với UI/UX nâng cao + session persistence.

#### Đã hoàn thành
- **Tạo lại `ArticlePreviewPanel.tsx`**: Panel sidebar bên phải, không chặn bảng bài viết. Dùng `window.open(url, "cms_review")` (regular tab, không popup) để giữ session CMS. Layout: Hero → CMS Bar → Meta Grid → Notes → Links.
- **Tích hợp vào `ArticlesPage.tsx`**: Lazy-load component, click tiêu đề mở panel thay vì mở tab mới. State `previewArticle` quản lý bài đang xem.
- **Layout responsive khi panel mở**: Thêm class `cms-panel-open` vào `<html>` khi panel mount. CSS mở rộng `max-width`, bỏ `margin: auto`, thêm `padding-right: 400px` cho `.app-shell-inner` để nội dung tự trải rộng thay vì bị panel đè.

#### Lỗi TypeScript build đang sửa

> **Nguyên nhân gốc:** TypeScript strict mode không nhận `filter(Boolean)` để loại `null` khỏi kiểu. Khi mảng SQL conditions chứa `null` (từ ternary) rồi spread vào `and()`, TS báo lỗi `Type 'null' is not assignable to 'SQLWrapper | undefined'`.

| File | Dòng | Lỗi | Trạng thái |
|------|------|------|------------|
| `editorial-tasks/reminders/route.ts` | 35 | `filter(Boolean)` + `null` → `and()` | ✅ Đã fix |
| `notifications/route.ts` | 104 | `filter(Boolean)` + `null` → `and()` | ✅ Đã fix |
| `payments/route.ts` | 265 | `filter(Boolean)` + `null` → `and()` | ✅ Đã fix |
| `payments/route.ts` | 315 | `filter(Boolean)` + `null` → `and()` | ✅ Đã fix |
| `articles/review/route.ts` | 252 | `eq(users.teamId, article.teamId)` — `article.teamId` là `number \| null` | ⏳ Đang fix |
| `payments/route.ts` | 195 | Object literal thiếu `teamId` property | ⏳ Đang fix |

**Cách fix chung:**
- Thay `null` → `undefined` trong ternary
- Thay `filter(Boolean)` → `filter((c): c is NonNullable<typeof c> => c != null)` (type guard)
- Với `eq()`: kiểm tra `!= null` trước khi gọi

#### Bài học rút ra
- **Luôn chạy `npx tsc --noEmit` local trước khi push** để bắt tất cả lỗi TS cùng lúc, tránh vòng lặp deploy-fail-fix-deploy.
- Pattern `[..., condition ? value : null].filter(Boolean)` là anti-pattern với drizzle strict types.

### Phiên chiều 11/03

- Tối ưu route nóng: `GET /api/notifications`, `getDeletePreview` đếm song song, `GET /api/statistics` narrow query, SSE fallback poll nới lên 5s.
- Luồng xóa bài tối ưu phản hồi: toast "đang xóa", spinner/disabled, audit+realtime chạy background.
- `MainApp.tsx` tách bundle lazy-load theo tab, preload chunk hover/focus/touch.
- `findMatchingCollaboratorPenNames` narrow bằng `ILIKE` trước, fallback full scan.
- `GET /api/statistics` cho user thường + admin đều đã tối ưu aggregate xuống SQL.
- Gỡ nút reviewer dang dở gây build fail, dọn helper xóa không dùng.
- Thêm mutation `deleteArticle`, Apps Script xử lý xóa trên toàn workbook.
- Vá quyền reviewer, dọn mô hình 3 quyền, bootstrap migrate `editor` → `reviewer`.
- Thêm trường `review_link`; form có ô "Đường dẫn duyệt bài".

## Việc còn cần nhớ

- **Redeploy Apps Script**: file `output/google-sheets-webhook.workdocker.gs` đã có handler `deleteArticle` nhưng cần deploy lại trên Google để có hiệu lực. Nếu chưa redeploy, xóa bài trên web vẫn thành công nhưng dòng trên Sheet sẽ không bị xóa (warning trong audit log).
- Luồng mở link duyệt bài hiện ưu tiên **copy link duyệt bài** thay vì điều hướng thẳng sang CMS, vì user đã xác nhận việc dán URL trực tiếp vào trình duyệt/tab CMS đang đăng nhập hoạt động ổn định hơn click cross-site từ web app.
- `findMatchingCollaboratorPenNames` vẫn còn fallback full-scan; nếu bảng lớn thêm nên dùng `pg_trgm`/`unaccent`.
- Route `statistics` fallback legacy vẫn đọc full bảng nếu narrow query trượt.
- `ArticlesPage` và `DashboardPage` vẫn là hai chunk client lớn nhất; bước tối ưu client kế tiếp nên ưu tiên các modal/import flow còn nằm chung trong `ArticlesPage.tsx`.
- `TeamPage` hiện vẫn là nơi duy nhất cần full payload của `/api/collaborators`; nếu tối ưu sâu hơn route này, có thể tách riêng một endpoint admin-detail để không phải giữ backward-compat trong cùng handler.
- Bootstrap schema version hiện là `5`; cần restart app hoặc để bootstrap chạy lại để tạo đủ cột/bảng team mới trên môi trường đang dùng DB cũ.
- Toàn bộ dữ liệu legacy hiện sẽ được gom vào `Team mặc định`; nếu muốn tách team thật sự sau migrate thì cần thao tác dữ liệu hoặc thêm màn hình chuyển người giữa team.
- `npm run lint` hiện vẫn quét `.next_stale_build`; nếu muốn sạch warning hoàn toàn có thể thêm ignore sau.
- Từ khóa `editor` còn lại chỉ dùng để map dữ liệu legacy.

## File nên mở đầu tiên

- `AGENTS.md`
- `docs/codex-thread-safety.md`
- `src/db/schema.ts`
- `src/lib/teams.ts`
- `src/app/api/teams/route.ts`
- `src/app/components/TeamPage.tsx`
- `src/app/api/articles/route.ts`
- `src/lib/google-sheet-sync.ts`
- `src/lib/google-sheet-mutation.ts`
- `src/app/api/articles/google-sync/webhook/route.ts`
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
