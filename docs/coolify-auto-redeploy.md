# Coolify Auto Redeploy

## Update 2026-03-25 16:12 ICT

- Auto redeploy da duoc nang tu cron moi phut len `systemd timer` moi `15 giay`.
- Timer hien tai tren VPS:
  - `/etc/systemd/system/ctv-management-coolify-autodeploy.service`
  - `/etc/systemd/system/ctv-management-coolify-autodeploy.timer`
- Cron cu da duoc go bo:
  - `/etc/cron.d/ctv-management-coolify-autodeploy`
- Queue script van giu nguyen:
  - `/usr/local/bin/ctv-management-coolify-queue.sh`
- Poller wrapper van giu nguyen:
  - `/usr/local/bin/ctv-management-coolify-autodeploy.sh`
- Xac nhan live tren VPS:
  - deployment `17` da `finished`
  - container dang chay commit `949092c2f8bf3bc05dba35c944dabd02c4ef7c4c`
  - timer da trigger lap lai thanh cong luc `16:12:24` va `16:12:40`

## Quy tac xac nhan truoc khi test

Khong duoc bao nguoi dung "da xong" neu chua du ca 4 dau hieu sau:

1. Commit da len `origin/main`.
2. Coolify deployment moi nhat da `finished`.
3. Container live dang chay dung image tag cua commit vua push.
4. Production URL that da duoc mo lai va kiem tra.

## Bối cảnh

- `ctv-management-app` trên Coolify đã bật `is_auto_deploy_enabled = true`.
- Tuy nhiên ứng dụng đang dùng nguồn `Public GitHub` (`source_type = GithubApp`, `source_id = 0`) và không có:
  - `repository_project_id`
  - `manual_webhook_secret_github`
- Vì vậy GitHub push không có đường webhook hợp lệ để tự tạo deployment như Vercel.

## Nguyên nhân gốc

- Vercel tự gắn chặt repo + webhook + build pipeline nên `push` là đủ.
- Bản Coolify hiện tại chỉ biết cách kéo code khi có:
  - GitHub App riêng với `repository_project_id` hợp lệ
  - hoặc manual GitHub webhook có secret
  - hoặc một cơ chế chủ động từ phía VPS/API gọi `queue_application_deployment(...)`
- Trạng thái cũ của app là “có kết nối đọc repo” nhưng “không có trigger deploy tự động”.

## Cơ chế đã cài trên VPS

### Script queue nhanh

- File: `/usr/local/bin/ctv-management-coolify-queue.sh`
- Mục đích:
  - đọc HEAD mới nhất của `main` từ GitHub
  - so với deployment mới nhất trên Coolify
  - nếu đã cùng commit thì trả `noop`
  - nếu đang có deployment khác chạy thì trả `busy`
  - nếu có commit mới thì queue deployment ngay

### Poller mỗi phút

- File: `/usr/local/bin/ctv-management-coolify-autodeploy.sh`
- Cron:
  - `/etc/cron.d/ctv-management-coolify-autodeploy`
- Log:
  - `/var/log/ctv-management-coolify-autodeploy.log`

Poller này giúp repo public vẫn có auto redeploy mà không cần cấu hình GitHub webhook ngay lập tức.

## Cách vận hành

### Trường hợp bình thường

1. Push code lên `main`.
2. Trong khoảng tối đa 1 phút, poller sẽ phát hiện HEAD mới.
3. Coolify tự queue deployment mới.
4. Chỉ test khi deployment mới đã `finished` và container live đã đổi sang commit mới.

### Trường hợp cần gấp

- Chạy trực tiếp trên VPS:

```bash
/usr/local/bin/ctv-management-coolify-queue.sh
```

Script này là đường nhanh nhất hiện có để ép Coolify redeploy mà không cần chờ cron.

## Quy ước xác nhận hoàn tất

Không xem một thay đổi là “xong” nếu chưa đủ cả 3 bước:

1. Code đã lên `origin/main`.
2. Coolify đã deploy xong commit đó.
3. Bản live đã được kiểm tra lại trên production URL thật.

## Hướng tốt hơn về lâu dài

Khi có điều kiện, nên thay poller bằng một trong hai cách sau:

- GitHub App/private source cấu hình đúng trong Coolify
- hoặc GitHub webhook/manual webhook với secret

Hai cách này sẽ gần với trải nghiệm `push -> redeploy` của Vercel hơn so với cơ chế poll mỗi phút.
