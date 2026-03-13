# AGENTS.md

## Mục tiêu

Giữ các thread Codex gọn, dễ nối tiếp, và tránh kẹt ở bước "Tự động nén ngữ cảnh".

## Bắt đầu ở đâu

- Đọc `docs/codex-handoff.md` trước khi quét mã nguồn.
- Nếu task liên quan tối ưu hiệu năng, build, deploy, hoặc dọn repo, đọc thêm `docs/optimization-memory.md` để tránh lặp lại các tối ưu đã làm.
- Nếu task liên quan `Bài viết`, lọc theo tháng, phân nhóm `CTV` / `Biên tập/Admin`, hoặc alias bút danh admin, đọc thêm `docs/article-filter-regression-2026-03-13.md`.
- Chỉ mở đúng thư mục hoặc file liên quan tới task đang làm.
- Khi cần hiểu luồng bài viết + Google Sheet, ưu tiên:
  - `src/app/api/articles/route.ts`
  - `src/app/api/articles/google-sync/route.ts`
  - `src/app/api/articles/google-sync/webhook/route.ts`
  - `src/lib/google-sheet-sync.ts`
  - `src/lib/google-sheet-mutation.ts`
  - `src/db/schema.ts`

## Guardrails ngữ cảnh

- Không quét đệ quy toàn repo từ root nếu chưa giới hạn phạm vi.
- Tránh đọc hoặc in output lớn từ các thư mục sau trừ khi task nhắm trực tiếp vào chúng:
  - `.next`
  - `node_modules`
  - `logs`
  - `output`
  - `data`
- Ưu tiên đọc theo block nhỏ hoặc theo dòng cần thiết thay vì dump cả file dài.
- Khi đã xác định được nguyên nhân, chuyển sang tóm tắt ngắn thay vì tiếp tục đọc lan.

## Guardrails nghiệp vụ bài viết

- Không suy ra `Biên tập/Admin` chỉ từ collaborator role.
- Nếu `linkedUserRole = admin`, coi đó là nguồn sự thật cho phân quyền và gắn nhãn bucket bài viết.
- Khi UI hiển thị tổng số theo nhóm `CTV` / `Biên tập/Admin`, không được tính từ một paginated slice trừ khi UI ghi rõ là `trang hiện tại`.
- Mỗi lần sửa `ArticlesPage.tsx`, `src/app/api/articles/route.ts`, `TeamPage.tsx`, hoặc code identity collaborator, phải test:
  - `Tháng 1 / 2026 / Tất cả bút danh`
  - bài alias `Đình Nhân` nằm trong `Bài của Biên tập/Admin`
  - `Admin team` vẫn hiện leader
  - tháng có hơn `ARTICLE_PAGE_SIZE` bài vẫn cho số đếm đúng

## Guardrails Git publish

- Không chạy `git commit` và `git push` song song.
- Nếu cần commit và push, ưu tiên dùng:
  - `powershell -ExecutionPolicy Bypass -File scripts/publish-safe.ps1 -StageAll -CommitMessage "<message>"`
- Sau khi push, phải xác minh `origin/<branch>` đã trỏ tới đúng local `HEAD`.

## Handoff bắt buộc

- Sau mỗi thay đổi đáng kể, cập nhật `docs/codex-handoff.md`.
- Nếu thay đổi liên quan hiệu năng/build/runtime/sync hygiene, cập nhật thêm `docs/optimization-memory.md`.
- Nếu thread đã dài hoặc vừa chạy nhiều lệnh đọc file, dừng để ghi handoff trước khi tiếp tục.
- Handoff nên ngắn và chỉ gồm:
  - trạng thái hiện tại
  - file đã chạm vào
  - việc còn dở
  - lệnh kiểm tra đã chạy

## Kiểm tra sau sửa code

- Ưu tiên chạy:
  - `npm run lint`
  - `npm run build`
- Nếu có thay đổi tới Apps Script, nhắc rõ việc cần redeploy file trong `output/`.
