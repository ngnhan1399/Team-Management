# Local Link Check Runner

## Mục tiêu

Runner này thay thế lịch GitHub Actions định kỳ cho FPT Shop.

Lý do:

- GitHub runner hiện có thể bị FPT Shop trả `403` cho cả link sống lẫn link chết.
- Máy local Windows của team cho kết quả ổn định hơn, nên được dùng làm runner chính.

## File chính

- `scripts/run-link-check-local.ps1`
- `scripts/register-link-check-scheduled-task.ps1`
- `scripts/link-check-browser-runner.mjs`

## Env local cần có

Tạo file `.env.link-check-runner.local` ở root repo với tối thiểu:

```env
LINK_CHECK_URL=https://www.workdocker.com/api/check-links
LINK_CHECK_AUTOMATION_TOKEN=...
LINK_CHECK_LIMIT=180
```

## Cài lịch trên Windows

Chạy:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/register-link-check-scheduled-task.ps1
```

Task được tạo:

- `Workdocker Link Check 09`
- `Workdocker Link Check 14`
- `Workdocker Link Check 22`

Lịch chạy:

- `09:00`
- `14:00`
- `22:00`

## Log

Runner ghi log vào:

- `logs/link-check-runner/`

## Ghi chú vận hành

- Task hiện là task user-level qua `schtasks`, nên máy cần đang bật và user đang đăng nhập Windows.
- GitHub workflow `Scheduled Link Check` vẫn giữ `workflow_dispatch` để debug thủ công, nhưng không còn cron định kỳ nữa.
