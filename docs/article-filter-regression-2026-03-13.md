# Article Filter Regression 2026-03-13

## Incident IDs

- `ARTICLES-IDENTITY-ROLE-001`
- `ARTICLES-SPLIT-PAGING-002`
- `OPS-CODEX-GIT-RACE-001`

## Kết luận ngắn

Không có chuyện tài khoản admin thật sự bị mất quyền trong DB.

Lỗi lớn xuất hiện vì 2 regression nghiệp vụ chồng lên nhau:

1. Hệ thống gắn nhãn bài `CTV` / `Biên tập/Admin` dựa quá nhiều vào hồ sơ collaborator và exact pen name.
2. Giao diện tách 2 khu `Bài của CTV` và `Bài của Biên tập/Admin` lại chia từ đúng `page` đang tải, không phải từ toàn bộ tập lọc của tháng.

Khi 2 lỗi này gặp nhau, bài admin có thể bị gắn nhãn `CTV`, còn khu `Biên tập/Admin` có thể hiện `0` dù dữ liệu thật vẫn còn trong DB.

## Điều đã xác minh

- `admin@ctvmanager.com` vẫn là:
  - `role = admin`
  - `is_leader = true`
- Tài khoản này vẫn link tới collaborator id `9`.
- Collaborator link có:
  - `name = Nguyen Dinh Nhan`
  - `pen_name = Nhan BTV`
  - `role = reviewer`

Nghĩa là quyền hệ thống không đổi. Vấn đề nằm ở lớp suy luận danh tính và lớp hiển thị.

## Root Cause 1: `ARTICLES-IDENTITY-ROLE-001`

Admin/editorial classification đã bị buộc chặt vào collaborator role và exact pen name.

Case thực tế:

- tài khoản leader admin lại link với collaborator có `role = reviewer`
- nhiều bài cũ của admin dùng pen name `Dinh Nhan`
- collaborator link lại dùng pen name `Nhan BTV`
- exact match không khớp nên fallback đi sai hướng
- một số nhánh logic ưu tiên role collaborator hơn `linkedUserRole = admin`

Hệ quả:

- bài admin bị gắn `CTV`
- khu `Bài của Biên tập/Admin` rỗng giả
- Team page có thể hiện `Admin team (0)` dù admin vẫn còn

Đã sửa bằng:

- alias normalization cho `Nguyen Dinh Nhan` / `Dinh Nhan` / `Nhan BTV`
- rule mới: nếu `linkedUserRole = admin` thì luôn ưu tiên coi là editorial/admin
- trả lại leader trong `Admin team`

Commit chính:

- `575e100` Fix admin article grouping and leader visibility

## Root Cause 2: `ARTICLES-SPLIT-PAGING-002`

UI tách `CTV` và `Biên tập/Admin` từ mảng `articles[]` của trang hiện tại, trong khi API chỉ trả về một page có `limit = 30`.

Điều này từng không gây lỗi rõ vì trước đây danh sách là một bảng chung. Khi UI được tách thành 2 khu riêng và có thẻ tổng số theo nhóm, cùng cách fetch cũ trở thành sai về bản chất.

Ví dụ đã xác minh trong DB:

- tháng `01/2026` có khoảng `298` bài trong team scope
- khoảng `103` bài thuộc alias admin/editorial
- nếu page đầu tình cờ toàn bài CTV thì UI sẽ báo `Bài của Biên tập/Admin = 0`

Đã sửa bằng:

- khi đang ở split view và có lọc `tháng/năm`, client nạp đủ dữ liệu của kỳ đó rồi mới chia nhóm
- API tăng trần `limit` để hỗ trợ split view theo tháng

Commit chính:

- `d1a0d5b` Fix split article filtering for monthly views

## Root Cause 3: `OPS-CODEX-GIT-RACE-001`

Đây là lỗi vận hành của agent, không phải bug runtime của app.

Thông điệp đã gặp:

- `Commit da xong. Lan push song song lai hut nhip truoc khi commit hoan thanh...`

Nguyên nhân:

- `git commit` và `git push` bị chạy song song
- lệnh push kết thúc trước khi commit mới tồn tại
- remote chưa nhận commit mới cho tới lần push kế tiếp

Đã sửa bằng:

- thêm guardrail vào `AGENTS.md`
- thêm script publish an toàn chạy tuần tự và verify remote head sau push

## Timeline regression

- `fed2fca`: siết author bucket nhưng vẫn tách nhóm từ page hiện tại
- `7bbbaab`: vá thêm month filter classification nhưng chưa chữa gốc split-after-pagination
- `575e100`: sửa alias admin + leader visibility
- `d1a0d5b`: sửa tận gốc lỗi split view theo tháng

## Checklist bắt buộc sau này

Mỗi lần chạm vào `ArticlesPage.tsx`, `src/app/api/articles/route.ts`, `TeamPage.tsx`, hoặc collaborator identity:

1. Test `Thang 1 / 2026 / Tat ca but danh`.
2. Xác minh bài `Dinh Nhan` nằm ở `Bài của Biên tập/Admin`.
3. Xác minh `Admin team` vẫn có leader.
4. Xác minh một tháng có hơn `ARTICLE_PAGE_SIZE` bài vẫn cho số đếm đúng.
5. Không bao giờ suy ra `editorial/admin` từ collaborator role một mình.
