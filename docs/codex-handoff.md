# Codex Handoff

## Trạng thái hiện tại

- Stack chính: `Next.js App Router` + `TypeScript` + `Drizzle ORM` + `PostgreSQL`.
- Nghiệp vụ nhạy cảm nhất hiện tại là đồng bộ bài viết hai chiều với Google Sheet.
- Luồng xóa `web -> Google Sheet -> DB` đã được vá để không còn xóa lệch dữ liệu âm thầm.
- Luồng phân quyền bài viết đã được chỉnh lại theo mô hình `admin` / `reviewer` / `writer`; reviewer giờ xem được hàng chờ duyệt và bài đã nhận duyệt.
- Repo đã có `AGENTS.md` và bộ tài liệu Codex để giảm nguy cơ kẹt thread do context quá dài.

## Thay đổi quan trọng gần nhất

Ngày cập nhật: `2026-03-11`

- Đã tối ưu một số route nóng theo hướng ít rủi ro: `GET /api/notifications` trả list + unread count song song, `getDeletePreview` đếm comment/review/notification/payment song song, `GET /api/statistics` cho user thường chỉ lấy các cột cần thiết thay vì kéo full row, và SSE fallback poll ở `api/realtime` đã nới từ 1.5s lên 5s để giảm tải DB.
- Luồng xóa bài đã được tối ưu cảm giác phản hồi: UI phát toast "đang xóa" ngay khi xác nhận, nút xóa đổi sang spinner/disabled, và API dời `writeAuditLog` + `publishRealtimeEvent` sang background để trả kết quả sớm hơn.
- `src/app/components/MainApp.tsx` đã được tách bundle theo tab: giữ `DashboardPage` eager vì là màn mặc định, còn các page nặng như `Articles`, `Team`, `Royalty`, `Audit`, `Notifications`... được `next/dynamic` lazy-load. Điều hướng còn preload chunk theo hover/focus/touch và chỉ commit chuyển trang sau khi chunk sẵn sàng để giảm cảm giác khựng khi đổi tab.
- `findMatchingCollaboratorPenNames` trong `src/app/api/articles/route.ts` giờ không đọc full bảng `collaborators` mặc định nữa; route sẽ thử narrow bằng `ILIKE` theo cụm search/token trước, chỉ fallback về full scan khi không tìm được candidate nào. Nhờ vậy các màn danh sách bài/xóa theo bộ lọc giảm khá nhiều tải ở case tìm kiếm phổ biến.
- `GET /api/statistics` cho user thường giờ build tập nhãn identity từ context + collaborator match rồi query `articles.pen_name` theo exact scope trước; chỉ fallback về đọc toàn bộ bảng khi narrow query không ra dữ liệu. Điều này giảm đáng kể trường hợp dashboard của CTV phải kéo cả bảng bài viết lên chỉ để lọc lấy bài của chính họ.
- Đã gỡ đoạn nút reviewer dang dở trong `src/app/components/ArticlesPage.tsx` còn gọi `setReviewArticle` / `setShowReviewModal` nhưng không còn state tương ứng; đây là nguyên nhân build production fail nên web chưa nhận được trường `review_link`.
- Dọn helper xóa không còn dùng trong `src/app/api/articles/route.ts` để giữ `npm run lint` sạch.
- Đã thêm mutation `deleteArticle` trong `src/lib/google-sheet-mutation.ts`.
- `DELETE /api/articles` giờ xác nhận xóa được trên Google Sheet rồi mới xóa DB.
- Apps Script xuất ra ở `output/google-sheets-webhook.workdocker.gs` giờ dò xóa trên toàn workbook để tránh báo thành công giả khi tìm nhầm tab.
- Đã vá quyền reviewer trong `src/lib/auth.ts`, `src/app/api/articles/route.ts`, `src/app/api/articles/review/route.ts`, `src/app/api/articles/comments/route.ts`, `src/app/components/ArticlesPage.tsx`.
- `POST /api/articles/review` giờ lưu cả `reviewerName` và `notes` vào DB để reviewer không bị mất bài sau khi gửi yêu cầu sửa.
- Đã dọn mô hình 3 quyền ở `src/app/components/TeamPage.tsx`, `src/app/api/collaborators/route.ts`, `src/db/schema.ts`, `src/db/index.ts`, `src/db/seed.ts`, `src/app/components/MainApp.tsx`.
- Bootstrap DB tự migrate `collaborators.role = 'editor'` cũ sang `reviewer` khi app khởi động.
- Đã thêm trường `review_link` cho bài viết; form bài viết có ô `Đường dẫn duyệt bài` và tiêu đề trong danh sách giờ ưu tiên mở link này.

## Việc còn cần nhớ

- `findMatchingCollaboratorPenNames` vẫn còn fallback full-scan để giữ đúng hành vi accent-insensitive/legacy matching; nếu bảng `collaborators` lớn thêm, bước tối ưu tiếp theo nên là cột search-normalized hoặc `pg_trgm`/`unaccent` thay vì chỉ dựa vào JS fallback.
- Route `statistics` cho user thường đã giảm mạnh lượng row phải tải ở case phổ biến, nhưng phần aggregate (`status`, `category`, `type`, `month`) vẫn tính trong JS sau khi query scope; nếu một user có rất nhiều bài thì nên đẩy thêm group/count xuống SQL.
- Luồng xóa vẫn chờ xác nhận từ Google Sheet trước khi xóa DB; nếu còn chậm bất thường thì cần đo riêng Apps Script/webhook vì timeout web app hiện là 8 giây.
- `MainApp` đã bớt nặng bundle đầu, nhưng nếu còn cảm giác chậm khi mở lần đầu từng tab thì nên đo tiếp chunk size của `ArticlesPage` và `DashboardPage`; đây nhiều khả năng là hai page client lớn nhất hiện tại.
- Nếu production chưa thấy ô `Đường dẫn duyệt bài` trong modal thêm/sửa bài, kiểm tra xem commit gỡ lỗi build reviewer đã được push và redeploy hay chưa.
- Cần redeploy Apps Script bằng file `output/google-sheets-webhook.workdocker.gs` mới nhất.
- Nếu chưa redeploy, thao tác xóa từ web có thể bị chặn để tránh lệch dữ liệu.
- UI đã hiện chi tiết lỗi xóa rõ hơn nếu Google Sheet chưa xác nhận được dòng gốc.
- Từ khóa `editor` còn lại chỉ dùng để map dữ liệu legacy hoặc nhận diện cột import cũ, không còn là role nghiệp vụ hiển thị cho người dùng.
- Bootstrap schema version hiện là `4`; cần restart app để cột `articles.review_link` được tạo trên DB hiện tại.

## File nên mở đầu tiên

- `AGENTS.md`
- `docs/codex-thread-safety.md`
- `src/app/api/articles/route.ts`
- `src/lib/google-sheet-sync.ts`
- `src/lib/google-sheet-mutation.ts`
- `src/app/api/articles/google-sync/webhook/route.ts`
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
