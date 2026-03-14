# Link Check FPT Regression 2026-03-14

## Incident IDs

- `LINKCHECK-FPT-BOTBLOCK-001`
- `LINKCHECK-FPT-NORMALIZE-002`
- `LINKCHECK-MANUAL-UNKNOWN-003`

## Kết luận ngắn

Lỗi link-check không đến từ một chỗ duy nhất.

Có 3 lớp vấn đề chồng lên nhau:

1. Vercel runtime bị FPT Shop bot-block nên manual check từ app có thể không nhìn thấy bài thật.
2. Logic phát hiện soft-404 chưa normalize đủ tiếng Việt, nên một số trang lỗi FPT Shop không bị bắt đúng.
3. Manual check có thể ghi đè trạng thái link từ `ok/broken` thành `unknown`, làm badge UI nhìn sai dù trước đó dữ liệu đúng.

## Điều đã xác minh

### Link mẫu sống

- `https://fptshop.com.vn/tin-tuc/for-gamers/di-bien-can-chuan-bi-gi-203076`
- Browser thật xác nhận:
  - status `200`
  - title bài viết hợp lệ
  - không có tín hiệu soft-404

### Link mẫu chết

- `https://fptshop.com.vn/tin-tuc/for-gamers/di-bien-can-chuan-bi-gi-203074`
- Browser thật xác nhận:
  - status `404`
  - title `404 - Trang hết hạn truy cập hoặc không tồn tại`
  - body có thông điệp `Đường dẫn đã hết hạn truy cập hoặc không tồn tại`

## Root Cause 1: `LINKCHECK-FPT-BOTBLOCK-001`

FPT Shop chặn một phần request từ Vercel datacenter.

Hệ quả:

- manual check từ `/api/check-links` trên Vercel có thể trả `403/429`
- các link sống bị rơi vào nhánh `unknown`
- nếu không có browser runner ngoài Vercel, hệ thống không phân biệt được link sống và link chết một cách ổn định

Đã sửa bằng:

- giữ lịch quét chính xác bằng GitHub Actions + Playwright Chromium thật
- workflow gọi API theo 2 phase:
  - `prepare`: xin danh sách link đến hạn
  - `persist`: trả kết quả browser-check về app để ghi DB

File chính:

- `src/app/api/check-links/route.ts`
- `scripts/link-check-browser-runner.mjs`
- `.github/workflows/link-check-schedule.yml`

Commit chính:

- `699cf42` Run scheduled FPT link checks in GitHub browser runner
- `a9f838a` Add manual inputs for browser link-check workflow

## Root Cause 2: `LINKCHECK-FPT-NORMALIZE-002`

Logic normalize trước đó bỏ dấu tiếng Việt nhưng không đổi `đ -> d`.

Hệ quả:

- chuỗi lỗi như `Đường dẫn đã hết hạn truy cập hoặc không tồn tại`
- sau khi fold sẽ vẫn còn `đ`
- pattern ASCII `duong dan...` không match
- một số trang 404 FPT Shop có thể bị lọt

Đã sửa bằng:

- thêm normalize `.replace(/đ/g, "d")` ở cả:
  - route backend check-link
  - browser fallback helper
  - GitHub browser runner
- backend đọc đủ HTML thay vì chỉ sniff quá ngắn ở đoạn đầu

File chính:

- `src/app/api/check-links/route.ts`
- `src/lib/link-health-browser.ts`
- `scripts/link-check-browser-runner.mjs`

Commit chính:

- `74a7b82` Fix FPT soft-404 normalization in link checks

## Root Cause 3: `LINKCHECK-MANUAL-UNKNOWN-003`

Manual check từ UI có thể nhận về `unknown` khi Vercel không xác minh được, rồi persist trực tiếp `unknown` xuống DB.

Hệ quả:

- link từng là `ok` hoặc `broken` bị ghi đè thành `unknown`
- UI badge chuyển sang `?` dù dữ liệu cũ đã đúng
- người dùng thấy hệ thống “không xác minh được link” cho cả link đang sống

Đã sửa bằng:

- manual check không còn ghi đè trạng thái đã biết thành `unknown`
- nếu không xác minh được ngay:
  - giữ nguyên trạng thái cũ nếu đã có
  - hoặc bỏ qua persist `unknown` nếu trước đó chưa có trạng thái chắc chắn
- toast UI nói rõ `đang chờ xác minh nền` thay vì làm người dùng hiểu nhầm là lỗi thật

File chính:

- `src/app/api/check-links/route.ts`
- `src/app/components/ArticlesPage.tsx`

Commit chính:

- `d7c8484` Avoid persisting manual unknown link states

## Dữ liệu đã sửa trên DB hiện tại

Đã chạy repair trực tiếp cho các dòng `link_health_status = 'unknown'` bằng fetch từ máy local:

- tổng `35` dòng `unknown`
- kết quả sau repair:
  - `30` dòng `broken`
  - `5` dòng `ok`
- sau repair:
  - `unknown = 0`

Các ví dụ đã được xác nhận trả lại `ok`:

- `203076`
- `203046`
- `202932`
- `203009`

## Quy trình vận hành chuẩn từ nay

### Khi user bấm `Kiểm tra link`

1. App gọi `POST /api/check-links` với `trigger = manual`.
2. Backend check nhanh trong phạm vi allowed của user.
3. Nếu gặp bot-block hoặc không xác minh được:
   - không được ghi đè trạng thái đã biết thành `unknown`
   - UI chỉ báo `đang chờ xác minh nền`

### Khi cần quét chính xác cho FPT Shop

1. Dùng GitHub Actions workflow `Scheduled Link Check`.
2. Workflow chạy Playwright Chromium thật trên Ubuntu.
3. Workflow lấy items bằng `phase = prepare`.
4. Workflow trả kết quả về app bằng `phase = persist`.
5. DB cập nhật `link_health_status`, `link_health_checked_at`, `link_health_check_slot`.

## Lịch tự động đang dùng

- `09:00` ICT
- `14:00` ICT
- `22:00` ICT

Cron hiện tại trong GitHub Actions:

- `0 2 * * *`
- `0 7 * * *`
- `0 15 * * *`

## Lệnh vận hành hữu ích

### Bắn workflow thủ công

```powershell
gh workflow run "Scheduled Link Check" --repo ngnhan1399/Team-Management -f slot_key=2026-03-14@manual-browser-recheck -f limit=20
```

### Theo dõi workflow

```powershell
gh run watch <run-id> --repo ngnhan1399/Team-Management --exit-status
```

### Xem log workflow

```powershell
gh run view <run-id> --repo ngnhan1399/Team-Management --log
```

## Checklist bắt buộc sau này

Mỗi lần chạm vào `check-links`, `ArticlesPage`, hoặc workflow browser runner:

1. Test một link sống FPT Shop.
2. Test một link chết FPT Shop.
3. Xác minh manual check không làm link `ok/broken` tụt về `unknown`.
4. Xác minh workflow GitHub vẫn persist được kết quả về DB.
5. Xác minh badge UI sau reload lấy đúng trạng thái DB mới nhất.
