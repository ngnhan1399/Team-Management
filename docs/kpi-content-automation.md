# KPI Content Automation

## Muc tieu

- KPI Content chi danh cho `admin/leader`, khong danh cho CTV.
- Khi bam `Dang ky KPI` tren bai editorial, app se gom toi da `5` bai cung nhom va gui form Google theo luong tu dong.
- Backend app co the submit truc tiep Google Form, khong can luu login Google rieng cua user.
- Apps Script chi con la phuong an proxy du phong, khong bat buoc cho flow mac dinh.

## Form da mapping

- Form URL:
  - `https://docs.google.com/forms/d/e/1FAIpQLScS-CMH8FwKAQQ_dcAGRzF__2l7G_dYo2Z4UxR5h--3XOF1_w/viewform`
- Logic nghiep vu van map theo `3 page`:
  - page 1:
    - `Nhan vien Content` -> `entry.2063490353`
    - `Dau viec content` -> `entry.1997176339`
  - page 2 - tin tuc:
    - `entry.1511448067`
    - option chinh:
      - `SEO AI`
      - `Bai dai - kho`
  - page 2 - mo ta:
    - `entry.1417839557`
    - option chinh:
      - `Viet mo ta dai`
      - `Viet mo ta ngan`
  - page 3 - link:
    - `entry.1708619375`
    - `entry.115890814`
    - `entry.1057708020`
    - `entry.779972713`
    - `entry.1418536144`

## Luong van hanh mac dinh

- App se:
  - tai `viewform` de lay `fbzx`, `partialResponse`, va `_sentinel`
  - gui `mot request cuoi` toi `formResponse`
  - request cuoi phai chua day du:
    - `employeeCode`
    - `task`
    - `detail`
    - toi da `5` link
    - `pageHistory = 0,1,2`

## Luu y ky thuat quan trong

- Form nay khong on dinh neu submit tung page rieng bang `pageHistory`.
- Cach submit da duoc verify an toan hon la:
  - mapping van theo 3 page
  - nhung submit that chi la `1 final POST`
- Nghia la:
  - logic chon field van theo 3 page
  - nhung khong gui tung page rieng nua

## Env can cau hinh

```env
KPI_CONTENT_SCRIPT_WEB_APP_URL=
KPI_CONTENT_SCRIPT_SECRET=
```

- Hai bien nay la `optional`.
- Neu bo trong, app se submit KPI Content truc tiep tu backend.
- Chi can set khi ban muon di qua Apps Script proxy rieng.

## Cach cai Apps Script (optional)

1. Mo Google Apps Script bang tai khoan automation chung co quyen voi form KPI Content.
2. Tao project script moi.
3. Dan noi dung tu [output/kpi-content-automation.workdocker.gs](J:/Data%20Management%20Project/ctv-management/output/kpi-content-automation.workdocker.gs).
4. Sua `KPI_CONTENT_SECRET` cho khop voi `KPI_CONTENT_SCRIPT_SECRET`.
5. Deploy `Web app`.
6. Chon chay bang tai khoan automation chung.
7. Cap quyen truy cap phu hop cho web app.
8. Lay URL web app va dien vao `KPI_CONTENT_SCRIPT_WEB_APP_URL`.

## Checklist test sau khi deploy script

1. Chac chan `employeeCode` da duoc dien cho admin/leader trong Team.
2. Neu ban dung Apps Script proxy, set du `KPI_CONTENT_SCRIPT_WEB_APP_URL` va `KPI_CONTENT_SCRIPT_SECRET`.
3. Dang ky 1 batch nho truoc, uu tien dung `NhanND18`.
4. Kiem tra batch trong tab KPI:
   - `queued`
   - `submitting_form`
   - `completed`
5. Neu fail voi HTTP `400`, uu tien kiem tra lai:
   - entry id cua form
   - option label cua form
   - `partialResponse` / `_sentinel` co thay doi hay khong

## Luu y van hanh

- Batch toi da `5` link.
- KPI Content hien chi submit form, khong dong bo Google Sheet.
- Neu form thay doi entry id hoac option label, cap nhat lai backend mapping va neu co dung proxy thi cap nhat lai file Apps Script mau va redeploy.
