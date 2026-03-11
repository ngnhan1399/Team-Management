# Codex Handoff

## Trạng thái hiện tại

- Stack chính: `Next.js App Router` + `TypeScript` + `Drizzle ORM` + `PostgreSQL`.
- Nghiệp vụ nhạy cảm nhất hiện tại là đồng bộ bài viết hai chiều với Google Sheet.
- Luồng xóa `web -> Google Sheet` giờ là **non-blocking**: bài xóa trên web luôn thành công, nếu Google Sheet sync thất bại thì chỉ ghi warning vào audit log và trả về response.
- Luồng phân quyền bài viết đã được chỉnh lại theo mô hình `admin` / `reviewer` / `writer`; reviewer giờ xem được hàng chờ duyệt và bài đã nhận duyệt.
- Tính năng "Duyệt lỗi" đã được gom vào luồng **Bình luận** duy nhất — chỉ còn 1 entry point cho phản hồi bài viết.
- Repo đã có `AGENTS.md` và bộ tài liệu Codex để giảm nguy cơ kẹt thread do context quá dài.

## Thay đổi quan trọng gần nhất

Ngày cập nhật: `2026-03-11` (phiên chiều)

### Phiên chiều 11/03

- **Gom "Duyệt lỗi" vào "Bình luận"**: xóa nút "Duyệt lỗi", modal review, state `showReviewModal`/`reviewArticle`/`errorNotes`, hàm `handleReview` trong `ArticlesPage.tsx`. Phản hồi bài viết giờ chỉ qua comment.
- **Fix xóa bài bị chặn bởi Google Sheet sync**: `ensureGoogleSheetDeleteConsistency` trong `articles/route.ts` giờ trả **warnings** (non-blocking) thay vì failures (blocking). Bài xóa trên web luôn thành công, warnings ghi vào audit log + trả về response.
- **Xóa `buildDeleteSyncFailureResponse`**: helper không còn dùng sau khi chuyển sang non-blocking.
- **Xóa mô tả chi tiết trong modal đồng bộ**: loại bỏ đoạn text giải thích engine/mirror/scope CTV và link Google Sheet cứng — tránh lộ thông tin triển khai.
- **Đã bỏ hẳn CMS Browser Panel**: theo yêu cầu mới, `ArticlesPage.tsx` không còn mở khung preview bên phải nữa. Click tiêu đề bài viết giờ mở thẳng `review_link` hoặc `link` như một link thường của trình duyệt, không đi qua `window.open` hay `target="cms_review"` nữa.
- **Tách `directory view` cho `/api/collaborators`**: các màn `Articles`, `EditorialTasks`, `Notifications`, `Royalty` không còn lấy full hồ sơ cộng tác viên nữa mà dùng `?view=directory`. Route chỉ trả field nhẹ cần cho dropdown/search/list, còn `TeamPage` vẫn giữ bản đầy đủ. Nhánh admin cũng bỏ cách ghép `allUsers.find(...)` lặp nhiều lần, chuyển sang `Map` để giảm chi phí join trong memory.

### Phiên sáng 11/03 và trước đó

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
- Luồng mở link duyệt bài hiện dùng link thường trực tiếp từ danh sách bài; không còn panel CMS bên trong app, cũng không còn cơ chế ép mở tab tên cố định.
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
