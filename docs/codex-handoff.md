# Codex Handoff

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
- Bootstrap schema version hiện tại trong code là `5`.

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
