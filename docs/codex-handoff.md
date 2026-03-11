# Codex Handoff

## Trạng thái hiện tại

- Stack chính: `Next.js App Router` + `TypeScript` + `Drizzle ORM` + `PostgreSQL`.
- Nghiệp vụ nhạy cảm nhất hiện tại là đồng bộ bài viết hai chiều với Google Sheet.
- Luồng xóa `web -> Google Sheet` giờ là **non-blocking**: bài xóa trên web luôn thành công, nếu Google Sheet sync thất bại thì chỉ ghi warning vào audit log và trả về response.
- Luồng phân quyền bài viết đã được chỉnh lại theo mô hình `admin` / `reviewer` / `writer`; reviewer giờ xem được hàng chờ duyệt và bài đã nhận duyệt.
- Tính năng "Duyệt lỗi" đã được gom vào luồng **Bình luận** duy nhất — chỉ còn 1 entry point cho phản hồi bài viết.
- Repo đã có `AGENTS.md` và bộ tài liệu Codex để giảm nguy cơ kẹt thread do context quá dài.

## Thay đổi quan trọng gần nhất

Ngày cập nhật: `2026-03-11` (phiên chiều 2)

### Phiên chiều 2 — 11/03 (đang thực hiện)

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
- Bootstrap schema version là `4`; cần restart app để cột `articles.review_link` được tạo.
- Từ khóa `editor` còn lại chỉ dùng để map dữ liệu legacy.

## File nên mở đầu tiên

- `AGENTS.md`
- `docs/codex-thread-safety.md`
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
