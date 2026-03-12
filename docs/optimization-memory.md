# Optimization Memory

Ngày cập nhật: `2026-03-13`

Tài liệu này là bộ nhớ tối ưu hóa của dự án. Mục tiêu là để các thread sau không lặp lại cùng một vòng "tối ưu lại từ đầu" nếu các thay đổi này vẫn còn hiệu lực.

## 1. Những tối ưu đã làm

### 1.1. Tooling và build hygiene

- `package.json`
  - thêm `typecheck`
  - `verify:safe = lint + typecheck`
  - `lint` chỉ quét `src`, `scripts` và các file config chính
  - bật `eslint --cache --cache-location .eslintcache`
- `tsconfig.json`
  - bỏ `allowJs`
  - thu hẹp `include`
  - exclude thêm `.agent`, `.vercel`, `docs`, `logs`, `output`, `tmp`, `data`
- `eslint.config.mjs`
  - ignore thêm các thư mục generated hoặc không thuộc code runtime
- `next.config.ts`
  - thêm `serverExternalPackages: ["bcryptjs", "pg", "xlsx"]`
- `.gitignore`
  - ignore thêm `.agent`, `.rune`, `.eslintcache`, `coverage`
- `.vercelignore`
  - loại trừ docs, logs, output, tmp và AI/generated context khỏi local deploy
- `.github/workflows/ci.yml`
  - thêm `concurrency`
  - cache `.next/cache`
  - cache Playwright browsers
  - chuyển sang `npm run verify:safe`

### 1.2. Runtime/client

- `ArticlesPage.tsx`
  - thêm `AbortController` để hủy request cũ khi search/filter/pagination đổi nhanh
  - giảm số lần effect kiểm tra `check-links` chạy lại bằng cách dùng `linkHealthRef` thay vì phụ thuộc trực tiếp vào `linkHealth` trong dependency array
  - dùng `ARTICLE_PAGE_SIZE` nhất quán hơn
  - tách constants/helpers sang `src/app/components/articles-page-config.ts`

### 1.3. Google Sheets sync

- `src/lib/google-sheet-sync.ts`
  - thêm guard chặn delete batch đáng ngờ khi reconcile từ sheet về app
  - guard dựa trên:
    - `GOOGLE_SHEETS_SYNC_MAX_DELETE_COUNT`
    - `GOOGLE_SHEETS_SYNC_MAX_DELETE_RATIO`
    - số dòng đang phải dùng fallback date
  - `refreshScopedArticlesFromGoogleSheet()` giờ tải workbook một lần rồi reuse cho toàn bộ group trong cùng request
  - song song hóa các bước chuẩn bị độc lập bằng `Promise.all` trong:
    - `refreshScopedArticlesFromGoogleSheet()`
    - `executeGoogleSheetSync()`
    - `executeGoogleSheetWorkbookSync()`
- `src/app/api/articles/google-sync/route.ts`
  - thêm `dynamic = "force-dynamic"`
  - thêm `maxDuration = 60`
- `src/app/api/articles/google-sync/webhook/route.ts`
  - thêm `dynamic = "force-dynamic"`
  - thêm `maxDuration = 60`
- `.env.example`
  - thêm biến guard cho delete trong sync

## 2. Vì sao không nên làm lại các tối ưu này

- Các tối ưu tooling ở trên đã giảm quét dư và tăng tốc vòng `lint/typecheck`.
- Guard trong Google Sheets sync không tắt đồng bộ; nó chỉ chặn các ca xóa có tín hiệu bất thường.
- Việc reuse workbook trong scoped sync đã loại bỏ một nguồn tải lặp rõ ràng khi đồng bộ nhiều bài thuộc nhiều tab.
- Tách constants/helpers khỏi `ArticlesPage.tsx` giúp giảm tải nhận thức và giảm độ phình của file nóng nhất phía client.

## 3. Khi nào mới nên xem xét tối ưu lại

Chỉ revisit nếu có ít nhất một trong các dấu hiệu sau:

- `npm run verify:safe` tăng thời gian rõ rệt sau một loạt thay đổi mới
- `ArticlesPage.tsx` lại phình thêm mạnh hoặc xuất hiện lag khi filter/search liên tục
- Google Sheets sync bắt đầu timeout hoặc load workbook nhiều lần sau khi đổi luồng
- Vercel deploy lại bắt đầu mang theo file rác hoặc generated artifacts
- CI bắt đầu có queue/cancel issues hoặc cache không còn hit hiệu quả

## 4. Những việc đã cân nhắc nhưng chưa làm

- Chưa tách hoàn toàn `ArticlesPage.tsx` thành nhiều component con hoặc custom hooks
  - vì cần refactor cẩn thận để tránh chạm quá nhiều state nghiệp vụ cùng lúc
- Chưa tách lớn `google-sheet-sync.ts` thành nhiều file phase-based
  - vì đây là lõi nhạy cảm, nên ưu tiên tối ưu có kiểm soát trước
- Chưa chốt được benchmark build production sạch trên máy local hiện tại
  - build vẫn bị ảnh hưởng bởi môi trường workspace/ổ đĩa hơn là lỗi TypeScript/lint

## 5. Baseline sau tối ưu

Đã xác nhận:

- `npm run lint` pass
- `npm run typecheck` pass
- `npm run verify:safe` pass

Repo hygiene hiện tại:

- `rune.config.json` đã được loại khỏi local working tree và thêm vào `.gitignore`

Lưu ý:

- `npm run build` chưa được xác nhận ổn định tuyệt đối trên workspace local hiện tại, nên đừng dùng máy local này làm benchmark cuối cùng cho build performance.

## 6. Nếu tiếp tục tối ưu ở các thread sau

Thứ tự ưu tiên nên là:

1. Tách `ArticlesPage.tsx` thành hooks + section components
2. Tách `google-sheet-sync.ts` theo phase:
   - workbook loading
   - row identity matching
   - reconcile/update
   - deletion guard
3. Benchmark build ở môi trường sạch hơn hoặc trên CI/Vercel thay vì chỉ dựa vào máy local hiện tại

## 7. File tham chiếu bắt buộc trước khi tối ưu tiếp

- `docs/optimization-memory.md`
- `docs/codex-handoff.md`
- `AGENTS.md`
