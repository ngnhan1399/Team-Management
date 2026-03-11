# Codex Handoff

## Trạng thái hiện tại

- Stack chính: `Next.js App Router` + `TypeScript` + `Drizzle ORM` + `PostgreSQL`.
- Nghiệp vụ nhạy cảm nhất hiện tại là đồng bộ bài viết hai chiều với Google Sheets.
- Luồng xóa `web -> Google Sheet` đang là **non-blocking**:
  - Xóa trên web luôn thành công nếu DB xử lý được.
  - Nếu sync Google Sheet lỗi thì chỉ ghi warning vào audit log và trả warning về response.
- Phân quyền bài viết hiện theo mô hình:
  - tài khoản: `admin` / `ctv`
  - cờ hệ thống: `isLeader`
  - cộng tác viên: `writer` / `reviewer`
- Reviewer hiện xem được hàng chờ duyệt và bài đã nhận duyệt trong đúng phạm vi của mình.
- Tính năng phản hồi bài viết hiện tập trung quanh luồng `comments` + `review state`, không còn tách rời kiểu cũ.
- Repo đã có tài liệu định vị tốt hơn:
  - `AGENTS.md`
  - `docs/codex-thread-safety.md`
  - `docs/project-map.md`

## Thay đổi quan trọng gần nhất

Ngày cập nhật: `2026-03-11`

### Phiên tối 2 — 11/03

**Mục tiêu:** Điều chỉnh logic Nhuận bút theo ngân sách CTV và bổ sung biểu đồ cân bằng `Viết mới / Viết lại`.

#### Đã hoàn thành

- Sửa backend `royalty` và `payments` để chỉ tính bài của `writer` vào ngân sách CTV.
- Loại bài của `reviewer` hoặc tài khoản `admin` khỏi:
  - dashboard ngân sách
  - top writers
  - royalty calculation
  - payment generation và payment listing
- Thêm `contentBalance` vào payload dashboard để trả về:
  - số bài `Viết mới`
  - số bài `Viết lại`
  - tỉ lệ phần trăm
  - mức chênh lệch
  - cờ cảnh báo lệch từ `10%`
- Cập nhật `RoyaltyPage.tsx`:
  - thêm biểu đồ tròn `Viết mới / Viết lại`
  - admin chỉ thấy tổng bài của CTV writer
  - CTV chỉ thấy bài của chính mình
  - thêm cảnh báo trực quan trong UI
  - thêm popup `alert` khi chênh lệch vượt ngưỡng

#### Kiểm tra đã chạy

- `npx eslint src/app/api/royalty/route.ts src/app/api/payments/route.ts src/app/components/RoyaltyPage.tsx src/app/components/types.ts src/lib/royalty.ts`
- `npx tsc --noEmit --pretty false`

### Phiên tối — 11/03

**Mục tiêu:** Bổ sung tài liệu định vị hệ thống và cập nhật lại overview cũ.

#### Đã hoàn thành

- Tạo `docs/project-map.md`:
  - mô tả cấu trúc thư mục
  - các module nghiệp vụ
  - bảng dữ liệu
  - phân quyền
  - luồng dữ liệu chính
  - script và CI
- Cập nhật `../project_overview.md` ở root workspace:
  - bỏ nội dung cũ lệch trạng thái thật
  - bỏ mô tả AI runtime/SQLite/single-file UI
  - thay bằng overview gọn và trỏ sang doc chi tiết mới

#### Ghi chú

- Không sửa code nghiệp vụ trong phiên này.
- Tài liệu cũ từng lệch với runtime hiện tại ở các điểm:
  - còn nói tới AI page
  - còn nói tới SQLite runtime
  - còn mô tả `page.tsx` kiểu single-file lớn

### Phiên chiều 2 — 11/03

**Mục tiêu:** Rebuild CMS Browser Panel với UI/UX nâng cao + session persistence.

#### Đã hoàn thành

- Tạo lại `ArticlePreviewPanel.tsx`:
  - panel sidebar bên phải
  - không chặn bảng bài viết
  - dùng `window.open(url, "cms_review")` để giữ session CMS
- Tích hợp vào `ArticlesPage.tsx`:
  - click tiêu đề mở panel thay vì mở tab mới
  - state `previewArticle` quản lý bài đang xem
- Layout responsive khi panel mở:
  - thêm class `cms-panel-open` vào `<html>`
  - nới rộng layout và chừa `padding-right` cho panel

### Các thay đổi quan trọng khác trong ngày 11/03

- Tối ưu `GET /api/notifications`, `GET /api/statistics`, `getDeletePreview` và SSE fallback poll.
- Luồng xóa bài tối ưu phản hồi:
  - toast đang xử lý
  - realtime/audit chạy background
- `MainApp.tsx` lazy-load theo tab và preload khi hover/focus/touch.
- Thêm mutation `deleteArticle` cho Apps Script để hỗ trợ xóa trên workbook.
- Vá quyền reviewer và chuẩn hóa migrate `editor -> reviewer`.
- Thêm trường `review_link`.

## Việc còn cần nhớ

- **Redeploy Apps Script**:
  - file `output/google-sheets-webhook.workdocker.gs` đã có handler `deleteArticle`
  - nhưng cần deploy lại trên Google để có hiệu lực
- Luồng mở link duyệt bài hiện ưu tiên copy `review_link` hoặc mở panel thay vì ép điều hướng cross-site.
- `findMatchingCollaboratorPenNames` vẫn còn fallback full scan; nếu dữ liệu lớn hơn nên cân nhắc `pg_trgm` hoặc `unaccent`.
- `ArticlesPage.tsx` và `google-sheet-sync.ts` vẫn là hai điểm phức tạp lớn nhất của codebase.
- Branding hiện còn chưa thống nhất:
  - package: `ctv-management`
  - README: `Team Management`
  - app name env: `Workdocker`
- Bootstrap schema version hiện tại trong code là `5`.

## File nên mở đầu tiên

- `AGENTS.md`
- `docs/codex-thread-safety.md`
- `docs/project-map.md`
- `src/db/schema.ts`
- `src/db/index.ts`
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

## Ghi chú kiểm tra gần nhất

- Trong phiên tài liệu này, chưa xác nhận được `lint/build` hoàn tất:
  - `npm run lint` treo quá lâu trong workspace hiện tại
  - `npm run build` có lúc vướng `.next/lock`, sau đó vẫn chạy quá lâu nên đã dừng
- Khi sửa code nghiệp vụ tiếp theo, nên chạy lại kiểm tra trong môi trường sạch hơn hoặc sau khi bảo đảm không còn tiến trình build/lint treo nền.

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
