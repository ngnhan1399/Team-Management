# KPI Content Response Cleanup

## Muc tieu

- Script nay dung de don cac dong KPI Content cu da bi submit sai truoc khi fix payload o commit `bfd7b5d`.
- Script nay khong dung de submit KPI moi.
- Script nay chay tren Google Spreadsheet dang chua response cua Google Form KPI Content.

## File can dung

- [output/kpi-content-response-cleanup.workdocker.gs](J:/Data%20Management%20Project/ctv-management/output/kpi-content-response-cleanup.workdocker.gs)

## Cach dung an toan

1. Mo Google Spreadsheet dang nhan response cua form KPI Content.
2. Mo `Extensions -> Apps Script`.
3. Tao project bound script cho spreadsheet do.
4. Dan noi dung tu [output/kpi-content-response-cleanup.workdocker.gs](J:/Data%20Management%20Project/ctv-management/output/kpi-content-response-cleanup.workdocker.gs).
5. Luu script va reload spreadsheet.
6. Chay `previewSuspiciousKpiContentRows()` truoc.
7. Mo `Execution log` de xem danh sach dong nghi ngo.
8. Neu danh sach dung nhu mong muon, chay `backupAndDeleteSuspiciousKpiContentRows()`.

## Logic match mac dinh

- Chi quet cac dong KPI Content co ngay thuoc incident `2026-03-25`.
- Chi quet `employeeCode = NhanND18`.
- Mac dinh chi danh dau/xoa nhung dong:
  - `Dau viec content` khong hop le
  - hoac `Chi tiet dau viec` khong hop le
  - hoac co dau hieu loi ma hoa
  - va dong thoi tat ca cot `Link` deu de trong

## Neu can mo rong pham vi

Sua block `KPI_CONTENT_CLEANUP_OPTIONS` trong script:

- `targetDatePrefixes`: doi ngay can quet
- `employeeCodes`: them/bot ma nhan vien
- `requireAllLinksEmpty`: dat `false` neu can quet ca dong co link
- `previewLimit`: so dong preview ghi ra log

## Backup truoc khi xoa

- Ham `backupAndDeleteSuspiciousKpiContentRows()` se:
  - tao mot sheet backup moi trong cung spreadsheet
  - copy toan bo dong nghi ngo sang sheet backup
  - them `Source Row` va `Cleanup Reasons`
  - roi moi xoa dong goc o response sheet

## Sau khi cleanup

1. Reload Google Spreadsheet.
2. Vao Looker Studio va refresh data source neu can.
3. Kiem tra lai dashboard `NhanND18`.
4. Neu can test lai flow KPI moi, chi test sau khi app da deploy ban chua commit `bfd7b5d`.
