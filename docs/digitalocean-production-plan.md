# DigitalOcean Production Plan

## Muc tieu

Muc tieu dai han cho du an nay la van hanh nhu mot cong cu noi bo cap cong ty, de mo rong dan thanh san pham ma khong phai doi ha tang som.

Stack toi khuyen nghi:

- App: DigitalOcean App Platform
- Database: DigitalOcean Managed PostgreSQL
- File storage: DigitalOcean Spaces hoac Cloudflare R2
- Auth: SSO theo Microsoft Entra ID hoac Google Workspace
- DNS/domain: ten mien rieng cua ban
- Host rieng hien co: chi dung cho ops, backup runner, BI, n8n, bastion

## Kien truc dich vu

- `app.tenmiencuaban.com`: App Platform, chay Next.js web + API
- `db`: Managed PostgreSQL, dat cung region voi app
- `files.tenmiencuaban.com`: bucket object storage cho tep import/export/dinh kem
- `staging.tenmiencuaban.com`: moi truong kiem thu truoc production
- `ops.tenmiencuaban.com`: host rieng hien co, dung cho cong cu van hanh noi bo

## Domain va DNS

Neu ban tu quan DNS:

- tao `app.tenmiencuaban.com` tro vao App Platform
- tao `staging.tenmiencuaban.com` cho moi truong kiem thu
- neu dung object storage, tao them `files.tenmiencuaban.com`

Neu muon DigitalOcean quan DNS, mo file `.do/app.template.yaml` va bo comment truong `zone`.

## Nhung gi repo da san sang

- co health endpoint o `/api/health`
- da them `Dockerfile` cho App Platform build on dinh
- da them `.dockerignore` de tranh day file du thua len image
- da bat `output: "standalone"` trong Next.js de image nho va de run hon
- da chuyen data layer sang PostgreSQL de phu hop voi Managed PostgreSQL tren DigitalOcean

## Nhung gi can lam truoc khi cho ca cong ty dung rong

### 1. Chuan hoa migrations

Repo hien dang bootstrap schema bang SQL runtime de de di chuyen. Buoc tiep theo nen bo sung migration files chinh thuc voi Drizzle Kit va workflow deploy ro rang.

### 2. Bo state trong memory cho cac tinh nang can scale

Hai diem nay chua phu hop khi tang quy mo:

- rate limit dang dung `Map` trong memory
- realtime subscriber dang dung `Map` trong memory

Huong doi:

- rate limit: Redis/Valkey hoac reverse proxy rate limiting
- realtime: polling ngan han hoac dich vu realtime ben ngoai nhu Ably/Pusher

### 3. Nang cap auth

Neu dung trong cong ty, uu tien SSO. Khong nen giu email/password custom lam co che dang nhap chinh khi quy mo tang.

### 4. Tiep tuc tach du lieu nhay cam

Khong de file import/export va tep dinh kem nam trong local runtime. Dua toan bo sang object storage.

## Trinh tu trien khai toi khuyen nghi

### Giai doan 1: dua len DigitalOcean de doi ngu dung thu

1. Push repo len GitHub/GitLab.
2. Tao PostgreSQL cluster cung region voi app.
3. Tao app tren App Platform tu repo hoac dung app spec:
   - `doctl apps create --spec .do/app.template.yaml`
4. Gan domain `app.tenmiencuaban.com`.
5. Set bien moi truong production.
6. Chay `npm run db:seed` vao database production/staging truoc lan login dau.
7. Xac nhan `/api/health` tra 200.

### Giai doan 2: hardening cho muc cong ty

1. Them SSO.
2. Them object storage.
3. Them backup/restore drill.
4. Them observability va alerting.
5. Tinh lai phan quyen va audit retention.

## Goi y su dung host rieng hien co

Toi khong khuyen chay app chinh tren host rieng o giai doan nay. Nen dung host do cho:

- Metabase/reporting
- n8n/automation noi bo
- backup runner
- VPN/bastion
- kho luu export theo lich

## Bien moi truong toi thieu

- `JWT_SECRET`
- `DATABASE_URL`
- `APP_ORIGIN`

Neu database yeu cau SSL va URL chua kem `sslmode=require`, them `DATABASE_SSL=require`.

## Chot huong di

Huong hop ly nhat cho du an nay la:

1. dung App Platform lam runtime chinh
2. dung domain rieng cho production va staging
3. dung Managed PostgreSQL lam data store chinh
4. giu host rieng cho ops thay vi app runtime
