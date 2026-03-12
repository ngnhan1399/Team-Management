# Codex Handoff

## Update 2026-03-12

- Tối ưu lại `ArticlesPage` để giảm cảm giác lag khi vừa mở tab bài viết:
  - không fetch danh bạ CTV ngay lúc mount nữa; chỉ tải khi admin mở filter, mở form bài viết hoặc mở tool xóa
  - dùng `useDeferredValue` + `requestIdleCallback` để dời link check sang idle time và chỉ check tối đa 10 URL mỗi đợt
  - tách modal xóa bài viết ra `ArticleDeleteModal` và lazy-load bằng `next/dynamic`
  - tách luôn `ArticleImportWizard` khỏi `ArticlesPage` và chỉ load khi mở modal import
- Sửa nút nghẽn lớn nhất của trang bài viết:
  - `GET /api/articles` không còn nhánh `splitView=true` kéo toàn bộ tập bài viết đã lọc về client
  - danh sách bài viết luôn lấy theo phân trang (`30` bài/trang), kể cả admin/reviewer
  - phân trang đáy giờ vẫn hiện cả khi UI đang tách nhóm CTV / Biên tập trên dữ liệu của trang hiện tại
  - query list chính ở API chỉ select các cột cần cho bảng + modal chỉnh sửa, không còn `select *`
- Đã xác nhận lại sau khi gỡ lỗi nhiễu từ OneDrive placeholder:
  - `npm run lint` pass, còn 2 warning cũ từ `.next_stale_build/*`
  - `npm run build` pass

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
