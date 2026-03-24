# Coolify VPS Production Notes

Ngay cap nhat: `2026-03-25`

Tai lieu nay chot lai huong van hanh cho ban deploy `ctv-management` len `Coolify + PostgreSQL tren cung VPS`, truoc khi gan domain.

## 1. Nguyen tac van hanh

- Chi public app qua `80/443`.
- Dashboard Coolify va cac cong quan tri khong nen mo rong rai hon muc can thiet.
- Production phai dung `APP_ORIGIN` / `APP_ORIGINS` cau hinh tuong minh.
- Neu chua gan domain/HTTPS va dang test bang `http://IP`, auth cookie phai duoc set theo request protocol thuc te; khong duoc ep `Secure` chi vi `NODE_ENV=production`.
- Sau khi DB da init on dinh, dat `DATABASE_BOOTSTRAP_MODE=skip`.
- Khong giu `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` trong runtime env sau khi tao admin dau tien.
- Google Sheets sync production phai cau hinh day du env, khong duoc dua vao fallback secret hoac default sheet URL.

## 2. Production init an toan

Cho DB production trong trang thai trong:

1. Dat env toi thieu:
   - `JWT_SECRET`
   - `DATABASE_URL`
   - `APP_ORIGIN`
2. Chay init admin-only:

```bash
npm run db:seed:admin-only
```

3. Dang nhap admin, doi mat khau ngay lan dau.
4. Xoa `SEED_ADMIN_EMAIL` va `SEED_ADMIN_PASSWORD` khoi runtime env.
5. Dat `DATABASE_BOOTSTRAP_MODE=skip`.

Khong dung `npm run db:seed` cho production neu khong muon seed collaborator demo.

## 3. Google Sheets sync

Production can set ro:

- `GOOGLE_SHEETS_ARTICLE_SOURCE_URL`
- `GOOGLE_SHEETS_WEBHOOK_SECRET`
- `GOOGLE_SHEETS_SCRIPT_WEB_APP_URL`
- `GOOGLE_SHEETS_SCRIPT_SECRET`

Neu chua set day du:

- webhook phai fail-closed
- manual sync khong nen override `sourceUrl` tren production
- khong mirror/chay sync vao sheet mac dinh

## 4. Backup va restore

Backup dockerized:

```bash
DATABASE_URL='postgresql://...' ./scripts/db-backup-docker.sh
```

Restore dockerized:

```bash
CONFIRM_RESTORE=restore DATABASE_URL='postgresql://...' ./scripts/db-restore-docker.sh /path/to/backup.dump
```

Khuyen nghi:

- backup daily tai Coolify/PostgreSQL resource
- co them 1 ban off-VPS
- tao manual snapshot truoc cac tac vu nhay cam:
  - bulk sync workbook
  - repair script
  - schema/init change
  - import lon

## 5. Retention runtime data

Dry-run:

```bash
npm run db:prune-runtime-data
```

Apply:

```bash
npm run db:prune-runtime-data:apply
```

Mac dinh:

- `realtime_events`: 30 ngay
- `notifications` da doc: 90 ngay
- `audit_logs`: khong prune neu chua set `PRUNE_AUDIT_LOGS_DAYS`

Neu can prune audit logs, set them env ro rang truoc khi chay.

## 6. Checklist truoc khi mo dung that

- `JWT_SECRET` da manh va rieng cho production
- `APP_ORIGIN` / `APP_ORIGINS` da dung origin that
- `DATABASE_BOOTSTRAP_MODE=skip`
- `AUTH_REGISTER_ENABLED=false`
- `SEED_ADMIN_*` da xoa khoi runtime env
- `GOOGLE_SHEETS_*` da set du va Apps Script da redeploy
- backup da chay thu va da test restore it nhat 1 lan
- chi public `80/443`; cong quan tri duoc han che phu hop
- neu chua co HTTPS/domain, khong coi day la ban production-ready cho nguoi dung that vi auth cookie can TLS
