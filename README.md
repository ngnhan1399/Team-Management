# CTV Management

Ung dung web quan ly cong tac vien viet bai: bai viet, binh luan/review, KPI, lich bien tap, nhuan but, ngan sach va audit log. Phan tro ly AI da duoc go bo.

## Tech Stack

- Next.js App Router + React + TypeScript
- Drizzle ORM + PostgreSQL
- Local dev va production: PostgreSQL
- Auth: JWT cookie + bcrypt
- Import/Export: XLSX
- Deployment target dai han: DigitalOcean App Platform + Managed PostgreSQL

## Bien moi truong

Tao `.env.local` tu `.env.example` roi cau hinh toi thieu:

- `JWT_SECRET`
- `DATABASE_URL`
- `APP_ORIGIN`

Bien tuy chon:

- `DATABASE_SSL`: dung khi provider yeu cau SSL va URL chua kem `sslmode=require`
- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_PASSWORD`

## Chay local

```bash
npm install
npm run db:seed
npm run dev
```

Mac dinh repo ky vong ban da co PostgreSQL local tai `postgresql://postgres:postgres@127.0.0.1:5432/ctv_management` hoac da tu set `DATABASE_URL`.

## Seed du lieu

`npm run db:seed` se:

- tao schema neu database chua co
- seed bang gia nhuan but
- seed du lieu cong tac vien demo da an danh
- seed 1 tai khoan admin demo

Neu khong truyen `SEED_ADMIN_PASSWORD`, script se sinh mat khau ngau nhien va in ra terminal.

## Scripts

- `npm run dev`: chay local
- `npm run build`: build production
- `npm run start`: chay production build
- `npm run lint`: kiem tra lint
- `npm run db:seed`: tao schema + seed du lieu demo
- `npm run test:smoke`: kiem tra schema + API trong yeu
- `npm run test:e2e-smoke`: build production va chay smoke test browser

## Deploy DigitalOcean

Repo nay da duoc them cac thanh phan de dua len DigitalOcean App Platform:

- `Dockerfile`: image production cho App Platform
- `.do/app.template.yaml`: app spec mau
- `/api/health`: endpoint health check
- `output: "standalone"`: toi uu cho runtime container

Tai lieu chi tiet nam o [docs/digitalocean-production-plan.md](docs/digitalocean-production-plan.md).

Luu y quan trong:

- production khong dung local filesystem lam database
- App Platform nen tro den DigitalOcean Managed PostgreSQL
- khong de file nghiep vu trong local filesystem cua container production

## Bao mat

- Khong commit `.env.local`.
- `JWT_SECRET` phai dai it nhat 32 ky tu.
- Cac route POST/PUT/DELETE co kiem tra same-origin cho cookie auth.
- Tu dang ky tai khoan da bi vo hieu hoa; admin tao tai khoan tu man hinh doi ngu.
- Nen doi ngay mat khau admin demo sau lan dang nhap dau tien.
