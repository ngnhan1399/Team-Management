# Implementation Progress Tracker

Last updated: 2026-03-07 (Asia/Saigon)

## Scope
Triển khai toàn bộ roadmap đã đề xuất:
- P0: Bảo mật + sửa lỗi logic quan trọng.
- P1: Cải thiện kiến trúc backend và chất lượng code.
- P2: Bổ sung tính năng nghiệp vụ mới.

## Workflow
- Trạng thái: `TODO` -> `IN_PROGRESS` -> `DONE` -> `BLOCKED`.
- Mỗi hạng mục khi làm xong sẽ cập nhật ngay trong file này.
- Ưu tiên hoàn thành P0 trước rồi mới sang P1/P2.

## Detailed Plan

### Phase P0 - Security & Critical Fixes
- [DONE] Tạo tracker tiến độ và kế hoạch chi tiết.
- [DONE] Tách `JWT_SECRET` riêng khỏi `GEMINI_API_KEY`.
- [DONE] Bổ sung kiểm tra auth/role cho API route trọng yếu.
- [DONE] Bổ sung rate-limit cho đăng nhập.
- [DONE] Bắt buộc nhập `oldPassword` khi đổi mật khẩu (trừ lần đầu).
- [DONE] Sửa route notifications để resolve đúng người nhận.
- [DONE] Sửa route article review để notify đúng CTV của bài.

### Phase P1 - Reliability & Maintainability
- [DONE] Loại bỏ `seedDatabase()` khỏi runtime request path.
- [DONE] Thêm script seed thủ công (`npm run db:seed`).
- [DONE] Cập nhật `.env.example` với biến bắt buộc mới.
- [DONE] Cập nhật README hướng dẫn setup an toàn.
- [DONE] Bổ sung lớp validation dùng chung (`src/lib/validation.ts`) và áp dụng cho API mở rộng.
- [DONE] Thêm smoke test (`npm run test:smoke`) cho schema + API trọng yếu.

### Phase P2 - Feature Expansion
- [DONE] Lịch biên tập + deadline/SLA + nhắc việc.
- [DONE] Comment theo bài + mention + file đính kèm.
- [DONE] Quy trình duyệt nhuận bút 2 bước + trạng thái thanh toán.
- [DONE] Audit log: ai sửa gì, lúc nào.

## Progress Log
- 2026-03-06: Khởi tạo file tracker và xác nhận thứ tự triển khai P0 -> P1 -> P2.
- 2026-03-06: Hoàn thành P0 backend security/hardening và bug fixes (auth, rate-limit, notifications, review flow).
- 2026-03-06: Loại cơ chế auto-seed runtime; thêm `npm run db:seed` bằng script thủ công.
- 2026-03-06: Cập nhật tài liệu setup + environment mẫu; loại key nhạy cảm khỏi `.env.local` trong workspace hiện tại.
- 2026-03-06: Hoàn thành hạng mục P2 Audit Log (bảng `audit_logs`, helper ghi log, API đọc log cho admin, gắn log vào action chính).
- 2026-03-07: Hoàn thành backend cho comment/mention (`/api/articles/comments`).
- 2026-03-07: Hoàn thành backend task biên tập + reminder (`/api/editorial-tasks`, `/api/editorial-tasks/reminders`).
- 2026-03-07: Hoàn thành backend payment workflow (`/api/payments`) với trạng thái `pending -> approved -> paid`.
- 2026-03-07: Bổ sung schema/tables/cột mới và script seed tương ứng.
- 2026-03-07: Sửa lỗi build TypeScript (`drizzle.config.ts`, `setPage` in dashboard). `npm run build` đã pass.
- 2026-03-07: `npm run test:smoke` pass.
- 2026-03-07: Hoàn thành UI comment/mention trong trang Articles (modal xem + gửi bình luận, attachment URL).
- 2026-03-07: Hoàn thành UI Lịch biên tập (`tasks` page) gồm lọc trạng thái, tạo/sửa task (admin), cập nhật trạng thái, trigger reminders.
- 2026-03-07: Hoàn thành tab workflow thanh toán trong Nhuận bút (generate, approve, mark-paid theo `/api/payments`).
- 2026-03-07: Verify sau tích hợp UI mới: `npm run build` pass, `npm run test:smoke` pass.
- 2026-03-07: Hoàn thành UI Audit Logs cho admin (lọc `action/entity`, giới hạn dòng, bảng payload chi tiết) và gắn vào sidebar.
- 2026-03-07: Dọn kỹ thuật nhanh trong `page.tsx`: bỏ state/handler không dùng (`contextMenu`, `generatedPassword`, `switchToCalc`), sửa init fetch của Audit để không vi phạm `react-hooks/set-state-in-effect`.
- 2026-03-07: Verify vòng 2: `npm run build` pass, `npm run test:smoke` pass; `npm run lint` còn 35 issues (giảm từ 41).
- 2026-03-07: Refactor type-safety lớn cho `page.tsx` (Auth, Dashboard, Import, Royalty), loại bỏ toàn bộ `any`, thay `<img>` avatar bằng `next/image`, fix parse/type issues.
- 2026-03-07: Verify vòng 3: `npm run lint` còn 2 warning (font ở `layout.tsx`), không còn lint errors ở `page.tsx`; `npm run build` pass; `npm run test:smoke` pass.
- 2026-03-07: Chuyển font chính sang `next/font` trong `layout.tsx` và dời Material Symbols sang `globals.css`; xóa hoàn toàn warning lint/font.
- 2026-03-07: Bắt đầu modularization `page.tsx`: tách `AuditLogsPage` thành `src/app/components/AuditLogsPage.tsx`.
- 2026-03-07: Tách `AuthProvider/useAuth` khỏi `page.tsx` sang `src/app/components/auth-context.tsx`.
- 2026-03-07: Verify vòng 4: `npm run lint` pass (0 warning, 0 error), `npm run build` pass, `npm run test:smoke` pass.
- 2026-03-07: Tạo lớp type dùng chung `src/app/components/types.ts` và tách `CustomSelect` thành `src/app/components/CustomSelect.tsx`.
- 2026-03-07: Tách các màn hình lớn khỏi `page.tsx`: `DashboardPage`, `NotificationsPage`, `ArticlesPage`, `RoyaltyPage` vào thư mục `src/app/components/`.
- 2026-03-07: Verify vòng 5 sau modularization lớn: `npm run lint` pass, `npm run build` pass, `npm run test:smoke` pass.
- 2026-03-07: Tiếp tục modularization: tách `TeamPage`, `EditorialTasksPage`, `AIPage`, `ProfilePage` từ `page.tsx` sang `src/app/components/`.
- 2026-03-07: Verify vòng 6: `npm run lint` pass, `npm run build` pass, `npm run test:smoke` pass.
- 2026-03-07: Hoàn tất tách luồng app shell/auth: tạo `AppRouter.tsx`, `MainApp.tsx`, `LoginPage.tsx`, `ChangePasswordPage.tsx`; rút `src/app/page.tsx` về entry point tối giản.
- 2026-03-07: Verify vòng 7 sau modularization sâu: `npm run lint` pass, `npm run build` pass, `npm run test:smoke` pass.
- 2026-03-07: Điều chỉnh `GET /api/auth/me` để trạng thái chưa đăng nhập không tạo console error giả ở màn login.
- 2026-03-07: Thêm `scripts/e2e-smoke.mjs` và script `npm run test:e2e-smoke` để kiểm tra login admin + điều hướng toàn bộ menu chính trên server production-like.
- 2026-03-07: Verify vòng runtime/e2e: `npm run lint` pass, `npm run test:smoke` pass, `npm run test:e2e-smoke` pass.
- 2026-03-07: Mở rộng `test:e2e-smoke` để cover mutation flow quan trọng: tạo task, xem comment bài viết, duyệt và đánh dấu đã trả cho payment.
- 2026-03-07: Thêm `data-testid` vào navigation, tasks, articles comments và payment workflow để ổn định hóa smoke test runtime.
- 2026-03-07: Thêm GitHub Actions workflow `.github/workflows/ci.yml` chạy `seed -> lint -> smoke -> e2e-smoke`.
- 2026-03-07: Verify vòng CI/runtime mở rộng: `npm run lint` pass, `npm run test:smoke` pass, `npm run test:e2e-smoke` pass với mutation flow `task/comment/payment`.
- 2026-03-07: Sửa regression UI nghiêm trọng sau refactor frontend: chuyển Material Symbols sang package local `@material-symbols/font-400`, khôi phục các CSS token alias cũ (`--gradient-1`, `--border`, `--success`, `--warning`, `--danger`, `--bg-dark`, ...) và chỉnh lại màu auth screens cho phù hợp light theme.
- 2026-03-07: Verify sau UI fix: kiểm tra trực tiếp bằng browser cho login + dashboard đã hiển thị đúng; `npm run lint` pass, `npm run build` pass.
- 2026-03-07: Sửa UX lỗi ở luồng `Đội ngũ -> Thêm thành viên`: modal sáng bị wash-out và tiêu đề trắng gần như vô hình; bổ sung validation/error state + trạng thái `Đang lưu...` trong `TeamPage`, verify lại bằng browser thêm thành viên thành công, rồi dọn dữ liệu test khỏi DB.
- 2026-03-07: Sửa toàn bộ luồng import Excel bài viết theo hướng phân tích workbook mạnh hơn: dò `sheet`, nhận diện `header row`, profile/gợi ý từng cột theo header + dữ liệu mẫu, preview mapping sau chuẩn hóa, hỗ trợ tùy chọn thay thế toàn bộ dữ liệu cũ khi import.
- 2026-03-07: Backup DB trước khi dọn dữ liệu sai vào `output/backups/ctv-management-before-article-reset-2026-03-07T09-07-35-451Z.db`, sau đó xóa sạch `articles`, `article_comments`, `article_reviews`, `payments` và notification gắn `related_article_id`.
- 2026-03-07: Verify importer mới bằng workbook giả lập có title row/merge cell + hidden sheet: analyzer nhận đúng `sheetName=Tong hop`, `headerRowNumber=3`, mapping chuẩn cho `date/title/penName`; import test ghi DB đúng và được dọn lại về trạng thái rỗng.
- 2026-03-07: Điều chỉnh `scripts/e2e-smoke.mjs` để tự tạo bài viết fallback nếu DB bài viết rỗng, tránh phụ thuộc dữ liệu seed cũ.
- 2026-03-07: Bổ sung công cụ xóa thông minh cho `Bài viết`: hỗ trợ xóa từng bài, xóa toàn bộ, xóa theo bộ lọc hiện tại hoặc tiêu chí tùy chỉnh (`tên bài`, `bút danh`, `trạng thái`, `tháng`, `năm`, `loại bài`, `loại nội dung`, `người duyệt`), luôn có bước preview trước khi xóa.
- 2026-03-07: Mở rộng API `DELETE /api/articles` với preview/bulk delete có cascade cho `article_comments`, `article_reviews`, `notifications` và reset `payments`; verify browser thực tế với các case xóa theo tên, theo tháng/năm và xóa toàn bộ, sau đó dọn sạch dữ liệu test khỏi DB.
- 2026-03-07: Verify vòng delete tool: `npm run lint` pass, `npm run build` pass, `npm run test:smoke` pass.
- 2026-03-07: Sửa dropdown bộ lọc `Bài viết` theo hướng giữ `CustomSelect` đồng bộ UI: thêm mode `portal-bottom` để dropdown luôn mở xuống dưới (không nhảy lên trên), áp dụng riêng cho filter panel bài viết và giữ mode auto cho các form/modal khác.
- 2026-03-07: Sửa nút `Nhập` ở `Bài viết`: chuyển sang trigger native file input phủ trong suốt trên button custom (không dùng `display:none` + JS click) để đảm bảo click luôn mở file picker ổn định giữa các browser; verify bằng browser automation (filechooser mở + import wizard hiển thị).
- 2026-03-07: Hotfix bổ sung nút `Nhập` ở `Bài viết`: dùng native `label htmlFor` (giữ UI custom), bỏ cơ chế dễ bị chặn picker (`preventDefault`/`showPicker`), đảm bảo click mở hộp chọn file ổn định; kiểm chứng bằng Playwright (`filechooser` event PASS).
- 2026-03-07: Khôi phục cột `Thao tác` và nút chỉnh sửa cho 2 bảng `Cộng tác viên duyệt` + `Biên tập viên` trong `TeamPage`; bổ sung trạng thái rỗng với `colSpan` đúng để không vỡ layout.
- 2026-03-07: Căn chỉnh lại layout bảng `Đội ngũ`: chuẩn hóa 3 bảng cùng 7 cột (`STT/Họ tên/Bút danh/Email/KPI/Trạng thái/Thao tác`), thêm `tableLayout: fixed` + `colgroup` dùng chung để cột thẳng hàng, tránh lệch vị trí giữa các khối.
- 2026-03-07: Nâng cấp importer Excel bài viết theo hướng dễ hiểu + chính xác hơn: thêm `dry-run preview` (xem trước dữ liệu chuẩn hóa trước khi nhập thật), checklist trường quan trọng (`ID/Ngày/Tiêu đề/Bút danh/Trạng thái/Link`), hướng dẫn map file có `STT` + `ID bài viết`, và tăng độ chính xác parser (không ưu tiên `STT` cho `Mã bài viết`, nhận diện `Done` => `Published`, bổ sung alias `Tình trạng duyệt`/`Nội dung sửa`).

## Current Status Summary
- P0: DONE
- P1: DONE
- P2: DONE

## Remaining Technical Debt (Non-blocking)
- Một số component vẫn khá lớn (`ArticlesPage.tsx`, `RoyaltyPage.tsx`), có thể tách tiếp theo domain (table, modal, filter panel, stats cards).
- 2026-03-07: Thiết kế lại bảng danh sách `Bài viết` để dễ nhìn và bớt cuộn: tăng chiều cao vùng hiển thị, chuyển bảng sang `tableLayout: fixed` + `colgroup`, giảm padding hàng để tăng mật độ thông tin, giới hạn tiêu đề 2 dòng có tooltip đầy đủ, canh lại cột thao tác về trung tâm cho cân bố cục.
- 2026-03-07: Nén lại row của danh sách `Bài viết`: phân bổ lại độ rộng cột để `Thao tác` đủ chỗ, khóa cụm icon thao tác thành 1 hàng ngang không wrap, giảm kích thước/padding icon button để không còn khoảng trắng dọc dư thừa giữa các bài.
- 2026-03-07: Tăng khả năng nhận diện ở danh sách `Bài viết`: tô màu badge `Loại bài` theo nhóm nội dung (`ICT`, `Gia dụng`, `Mô tả`, `Review/Dịch`, `Thủ thuật`) và bổ sung nhãn chữ ở cột `Link`; link lỗi hiển thị đỏ với chú thích `Link lỗi` để người dùng nhận ra ngay.
- 2026-03-07: Thiết kế lại flow đăng nhập cho CTV: trang login có 2 tab `Đăng nhập` và `Tạo mới`; thêm API `POST /api/auth/register` cho phép email đã có sẵn trong `collaborators` tự tạo tài khoản lần đầu bằng cách đặt mật khẩu, tự đăng nhập sau khi tạo xong, và chặn tạo trùng nếu email/collaborator đã có user.
