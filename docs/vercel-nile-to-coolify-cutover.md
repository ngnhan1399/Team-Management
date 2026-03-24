# Vercel + Nile to Coolify + PostgreSQL Cutover

Ngay cap nhat: `2026-03-25`

Tai lieu nay chot lai cach di chuyen ban production that tu `Vercel + Nile` sang `Coolify + PostgreSQL tren VPS`.

## 1. Source of truth da xac nhan

- Repo dang linked voi Vercel project: `team-management`
- Vercel scope: `nhans-projects-1be8e712`
- Production aliases hien tai:
  - `https://www.workdocker.com`
  - `https://workdocker.com`
  - `https://team-management-sigma.vercel.app`
  - `https://team-management-nhans-projects-1be8e712.vercel.app`
- Deployment production duoc verify qua `vercel inspect www.workdocker.com`

## 2. Env production da inventory tren Vercel

Da verify bang `vercel env ls production` va `vercel env pull --environment=production`.

### Nhom core

- `APP_ORIGIN`
- `JWT_SECRET`
- `DATABASE_URL`
- `DATABASE_POSTGRES_URL`
- `DATABASE_NILEDB_URL`
- `DATABASE_NILEDB_POSTGRES_URL`
- `DATABASE_NILEDB_USER`
- `DATABASE_NILEDB_PASSWORD`
- `DATABASE_NILEDB_API_URL`
- `DATABASE_BOOTSTRAP_MODE`

### Nhom sync / automation

- `GOOGLE_SHEETS_SCRIPT_WEB_APP_URL`
- `GOOGLE_SHEETS_SCRIPT_SECRET`
- `CONTENT_WORK_SCRIPT_WEB_APP_URL`
- `CONTENT_WORK_SCRIPT_SECRET`
- `LINK_CHECK_AUTOMATION_TOKEN`

### Ghi chu quan trong

- Tai thoi diem audit, `GOOGLE_SHEETS_ARTICLE_SOURCE_URL` khong xuat hien trong danh sach env production tren Vercel. Truoc khi cutover that, can xac nhan luong sync hien tai dang lay source URL tu dau.
- Khong can copy cac bien `VERCEL_*` sang Coolify. Do la metadata build/runtime cua Vercel.
- Tren Coolify/PostgreSQL moi, nen chuan hoa ve `DATABASE_URL` thay vi giu bo Nile-specific env.

## 3. Script migration DB

Script van hanh hien dung:

- [scripts/migrate-neon-to-nile.mjs](/J:/Data%20Management%20Project/ctv-management/scripts/migrate-neon-to-nile.mjs)

Da duoc sua lai de dung duoc cho cutover production:

- cover them:
  - `content_work_registrations`
  - `kpi_monthly_targets`
- preserve serial IDs that su bang explicit insert
- reset lai target sequences sau import
- import trong transaction de tranh DB dich roi vao trang thai nua chung

## 4. Khong duoc coi cutover la hoan tat neu thieu cac buoc nay

1. Mirror env production sang Coolify
2. Import du lieu Nile production sang PostgreSQL tren VPS
3. Repoint toan bo Apps Script / webhook / link-check runner sang domain moi
4. Gan domain + HTTPS
5. Cap nhat `APP_ORIGIN` / `APP_ORIGINS` theo domain that
6. Smoke test login, articles, royalty, payments, Google sync, Content Work, link-check
7. Giu Vercel + Nile write-frozen de rollback neu can

## 5. Checklist cutover that

### Pha 1 - chuan bi

1. Backup DB dich tren VPS
2. Export inventory env production tren Vercel
3. Xac nhan Apps Script endpoints va local/GitHub runners dang tro vao dau
4. Chot maintenance window ngan de tranh mat write trong luc copy du lieu cuoi

### Pha 2 - staging tren VPS

1. Import du lieu production vao PostgreSQL tren VPS
2. Set env tren Coolify tu bo production
3. Khong public cho nguoi dung that neu chua co domain + TLS
4. So sanh so luong row giua source va target cho cac bang:
   - `users`
   - `teams`
   - `collaborators`
   - `articles`
   - `article_sync_links`
   - `content_work_registrations`
   - `payments`
   - `notifications`
   - `audit_logs`

### Pha 3 - cutover cuoi

1. Freeze write tren ban Vercel
2. Chay import cuoi cung tu Nile sang PostgreSQL VPS
3. Redeploy Coolify voi env production chinh thuc
4. Doi domain/DNS
5. Repoint webhook Apps Script va link-check runner
6. Verify:
   - `/api/health`
   - login admin
   - xem articles
   - tinh / xem payment
   - Google Sheet -> app
   - app -> Google Sheet
   - Content Work automation

### Pha 4 - rollback window

- Giu nguyen Vercel + Nile it nhat `48-72h`
- Neu co loi nghiem trong:
  - tra DNS/domain ve Vercel
  - mo write lai tren ban cu
  - dung VPS production de tiep tuc debug

## 6. Bo env can co tren Coolify production

- `APP_ORIGIN`
- `APP_ORIGINS` neu can nhieu origin hop le
- `JWT_SECRET`
- `DATABASE_URL`
- `DATABASE_BOOTSTRAP_MODE=skip`
- `AUTH_REGISTER_ENABLED=false`
- `GOOGLE_SHEETS_ARTICLE_SOURCE_URL`
- `GOOGLE_SHEETS_WEBHOOK_SECRET`
- `GOOGLE_SHEETS_SCRIPT_WEB_APP_URL`
- `GOOGLE_SHEETS_SCRIPT_SECRET`
- `GOOGLE_SHEETS_SYNC_MAX_DELETE_COUNT`
- `GOOGLE_SHEETS_SYNC_MAX_DELETE_RATIO`
- `CONTENT_WORK_SCRIPT_WEB_APP_URL`
- `CONTENT_WORK_SCRIPT_SECRET`
- `LINK_CHECK_AUTOMATION_TOKEN`
- `NEXT_PUBLIC_APP_NAME`

## 7. Nho cho thread sau

- Production that dang nam o Vercel project `team-management`, khong phai project `ctv-management`
- Cutover nay la `code + env + DB + integrations`, khong phai chi push repo
- Truoc khi migrate DB that, uu tien dung script da sua, khong dung ban cu cua `migrate-neon-to-nile.mjs`
