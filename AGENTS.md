# AGENTS.md

## Mục tiêu

Giữ các thread Codex gọn, dễ nối tiếp, và tránh kẹt ở bước "Tự động nén ngữ cảnh".

## Bắt đầu ở đâu

- Đọc `docs/codex-handoff.md` trước khi quét mã nguồn.
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

## Handoff bắt buộc

- Sau mỗi thay đổi đáng kể, cập nhật `docs/codex-handoff.md`.
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
