# Team Management

Ứng dụng web hỗ trợ quản lý cộng tác viên và quy trình sản xuất nội dung trong một đội ngũ làm việc thực tế.

Mục tiêu của dự án là gom toàn bộ các phần việc rời rạc như quản lý bài viết, theo dõi tiến độ, lịch biên tập, nhuận bút, ngân sách và lịch sử thao tác vào một nơi duy nhất để đội ngũ vận hành dễ hơn, minh bạch hơn và tiết kiệm thời gian hơn.

## Dự án này giải quyết bài toán gì?

Trong quá trình làm nội dung, dữ liệu thường bị chia nhỏ ở nhiều nơi: file Excel, tin nhắn, ghi chú tay, hoặc cập nhật thủ công giữa nhiều người. Điều đó dễ dẫn tới thiếu đồng bộ, khó kiểm soát tiến độ và mất thời gian khi tổng hợp báo cáo.

`Team Management` được xây dựng để xử lý các vấn đề đó theo hướng rõ ràng và có thể mở rộng:

- Quản lý cộng tác viên và thông tin làm việc tập trung
- Theo dõi bài viết từ lúc tạo đến lúc hoàn thành
- Ghi nhận review, bình luận và lịch sử xử lý
- Theo dõi KPI, lịch biên tập và nhuận bút
- Kiểm soát ngân sách và audit log phục vụ vận hành nội bộ

Phần trợ lý AI đã được tạm gỡ khỏi hệ thống để ưu tiên sự ổn định cho phiên bản vận hành thật.

## Tính năng chính

- Quản lý danh sách cộng tác viên và trạng thái hoạt động
- Quản lý bài viết, người phụ trách, deadline và tiến độ
- Review nội dung, bình luận và theo dõi thay đổi
- Theo dõi KPI theo đầu việc
- Quản lý lịch biên tập theo kế hoạch nội dung
- Tính nhuận bút và theo dõi ngân sách
- Lưu audit log để truy vết thao tác quan trọng
- Import và export dữ liệu bằng Excel

## Công nghệ sử dụng

- `Next.js App Router`
- `React`
- `TypeScript`
- `Drizzle ORM`
- `PostgreSQL`
- `JWT Cookie + bcrypt` cho xác thực
- `XLSX` cho import/export dữ liệu

Định hướng triển khai dài hạn của dự án là:

- `DigitalOcean App Platform`
- `DigitalOcean Managed PostgreSQL`

## Cấu trúc triển khai hiện tại

Repo đã được chuẩn bị sẵn để đi theo hướng production:

- `Dockerfile` để build và chạy app theo môi trường production
- `.do/app.template.yaml` làm mẫu cấu hình cho DigitalOcean App Platform
- `/api/health` để health check khi deploy
- `output: "standalone"` để tối ưu runtime container

Tài liệu triển khai chi tiết nằm tại [docs/digitalocean-production-plan.md](docs/digitalocean-production-plan.md).

## Biến môi trường cần có

Tạo file `.env.local` từ `.env.example`, sau đó cấu hình tối thiểu:

- `JWT_SECRET`
- `DATABASE_URL`
- `APP_ORIGIN`

Biến bổ sung khi cần:

- `APP_ORIGINS`
- `DATABASE_SSL`
- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_PASSWORD`

## Cài đặt và chạy local

Trước khi chạy, bạn cần có PostgreSQL local hoặc một PostgreSQL server mà bạn có quyền kết nối tới.

Ví dụ mặc định của dự án:

```bash
postgresql://postgres:postgres@127.0.0.1:5432/ctv_management
```

Các bước khởi chạy:

```bash
npm install
npm run db:seed
npm run dev
```

Sau khi chạy thành công, ứng dụng sẽ sẵn sàng ở môi trường local để bạn kiểm tra giao diện và luồng nghiệp vụ.

## Seed dữ liệu mẫu

Lệnh:

```bash
npm run db:seed
```

Script seed sẽ:

- Tạo schema nếu database chưa có
- Tạo dữ liệu mẫu phục vụ trải nghiệm nhanh
- Seed bảng giá nhuận bút
- Tạo tài khoản admin demo

Nếu bạn không truyền `SEED_ADMIN_PASSWORD`, hệ thống sẽ tự sinh mật khẩu tạm thời và in ra terminal.

## Scripts thường dùng

- `npm run dev`: chạy môi trường phát triển
- `npm run build`: build production
- `npm run start`: chạy production build
- `npm run lint`: kiểm tra mã nguồn
- `npm run db:seed`: tạo schema và dữ liệu mẫu
- `npm run test:smoke`: kiểm tra schema và các API chính
- `npm run test:e2e-smoke`: build production và chạy smoke test giao diện

## Lưu ý bảo mật

- Không commit `.env.local`
- `JWT_SECRET` nên dài ít nhất `32` ký tự
- Các route ghi dữ liệu có kiểm tra `same-origin`
- Tự đăng ký tài khoản đã bị vô hiệu hóa
- Tài khoản do admin tạo nên được đổi mật khẩu ngay sau lần đăng nhập đầu tiên
- Không dùng local filesystem của container làm nơi lưu dữ liệu production

## Phù hợp với ai?

Dự án này phù hợp nếu bạn đang cần một công cụ nội bộ để:

- Quản lý đội ngũ cộng tác viên viết bài
- Theo dõi quy trình sản xuất nội dung theo nhóm
- Kiểm soát nhuận bút, ngân sách và tiến độ thực hiện
- Chuẩn hóa dữ liệu vận hành trước khi mở rộng quy mô

## Định hướng phát triển

Các bước phù hợp để đưa dự án lên mức vận hành lâu dài:

- Hoàn thiện deploy lên DigitalOcean
- Kết nối PostgreSQL production ổn định
- Tăng cường quan sát hệ thống và backup dữ liệu
- Từng bước nâng cấp phân quyền và quy trình vận hành nội bộ

---

Nếu bạn đang tìm một nền tảng quản lý cộng tác viên gọn gàng, rõ ràng và đủ thực dụng để dùng trong công việc thật, đây là một điểm bắt đầu rất tốt để tiếp tục phát triển.
