# Codex Thread Safety

Tài liệu này dùng để giảm khả năng Codex bị treo ở bước "Tự động nén ngữ cảnh" và giúp mở thread mới mà không mất mạch làm việc.

## Vì sao thread dễ bị kẹt

Các thread thường phình rất nhanh khi:

- quét đệ quy từ root của repo
- đọc cả file rất dài thay vì mở từng đoạn
- in output terminal hàng nghìn dòng
- lặp lại việc đọc các thư mục generated như `.next` hoặc `node_modules`

## Cách làm việc an toàn

1. Đọc `docs/codex-handoff.md` trước.
2. Xác định đúng khu vực cần sửa.
3. Chỉ mở những file liên quan trực tiếp.
4. Sau mỗi mốc lớn, ghi handoff ngắn.
5. Khi thread đã dài, chốt handoff rồi chuyển thread mới nếu cần.

## Quy tắc đọc file

- Tốt:
  - mở theo path cụ thể
  - đọc theo block nhỏ
  - tìm đúng keyword rồi mới mở file
- Không tốt:
  - dump cả file dài
  - dump cả thư mục generated
  - chạy liền nhiều lệnh trả về hàng nghìn dòng

## Quy tắc tóm tắt

Một handoff tốt chỉ cần trả lời 4 câu:

- Đang ở bước nào?
- Đã sửa file nào?
- Còn thiếu gì?
- Đã kiểm tra bằng lệnh nào?

## Khi thread đã có dấu hiệu nặng

Nên dừng và ghi handoff nếu vừa xảy ra một trong các tình huống sau:

- đã đọc nhiều file lớn liên tiếp
- đã chạy lệnh trả về rất nhiều dòng
- đã chạm vào nhiều hơn 3 file nghiệp vụ
- đã hoàn thành một bugfix hoặc một nhánh tính năng rõ ràng

## Bộ đôi nên dùng mỗi lần mở thread mới

- `docs/codex-handoff.md`
- `AGENTS.md`
