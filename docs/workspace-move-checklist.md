# Workspace Move Checklist

Updated: 2026-03-12

## Goal

Move the active repo out of OneDrive so Codex, Next.js, npm, and Git can work without sync/file-lock overhead.

Recommended target:

- `D:\Projects\ctv-management`
- or another local internal SSD path outside OneDrive/Dropbox/Google Drive

Acceptable fallback:

- external SSD, USB 3.x, `NTFS`, stable cable/port

Avoid:

- keeping the active working copy inside any synced cloud folder
- opening Codex at the parent folder that also contains backups

## Current repo state

- Current branch: `codex/repo-hygiene-safe-verify`
- Pushed Codex commits already on that branch:
  - `fc2539a` (`chore: clean repo artifacts and add safe verification`)
  - `4e48989` (`perf: make runtime db bootstrap optional`)
  - `2fb4751` (`docs: add workspace move handoff checklist`)
- `origin/main` currently points to `9391ea1`
- Remote repo: `https://github.com/ngnhan1399/Team-Management.git`
- Suggested PR URL:
  - `https://github.com/ngnhan1399/Team-Management/pull/new/codex/repo-hygiene-safe-verify`

## What was completed in this session

1. Audited repo state, GitHub remote alignment, and local changes.
2. Ran safe checks:
   - `npm run lint`
   - `npx tsc --noEmit --pretty false`
   - `npm run build`
3. Confirmed `npm run test:smoke` needs a reachable PostgreSQL instance and currently fails locally when no DB is listening on `127.0.0.1:5432`.
4. Cleaned tracked stale artifacts and conflict-copy files from the repo.
5. Tightened `.gitignore` and ESLint ignores to avoid scanning/generated noise.
6. Added `npm run verify:safe` for a no-database baseline check (lint + typecheck).
7. Added optional `DATABASE_BOOTSTRAP_MODE=skip` so stable production can avoid runtime schema bootstrap queries while `/api/health` still performs a lightweight DB ping.
8. Pushed all Codex-made changes to branch `codex/repo-hygiene-safe-verify`.

## Important local-only change to preserve

There is still one unstaged user change in:

- `src/lib/google-sheet-sync.ts`

Current local diff:

```diff
- const initialTarget = matchedByCurrentSheet ?? matchedByLink ?? matchedByComposite ?? matchedByArticleId;
+ const initialTarget = matchedByCurrentSheet ?? matchedByArticleId ?? matchedByComposite ?? matchedByLink;
```

Current line in working tree:

- `src/lib/google-sheet-sync.ts:1464`

If you move by making a fresh clone instead of copying the working directory, re-apply this one-line change manually before asking Codex to continue.

## Safest move procedure

1. Close all terminals, `next dev`, editors, and any app holding files in the repo.
2. In OneDrive settings, pause sync temporarily if possible.
3. Choose one of the two move strategies below.

### Strategy A: Fresh clone (recommended)

1. Create a new folder outside OneDrive, for example `D:\Projects`.
2. Clone the repo there:
   - `git clone https://github.com/ngnhan1399/Team-Management.git`
3. Enter the repo and switch to the working branch:
   - `git checkout codex/repo-hygiene-safe-verify`
4. Re-apply the one-line local change in `src/lib/google-sheet-sync.ts`.
5. Copy `.env.local` from the old repo only if you still need the same local environment values.
6. Run:
   - `npm ci`
   - `npm run verify:safe`
   - optional on NTFS/internal SSD: `npm run verify:full`

### Strategy B: Move the whole working copy

1. Copy the entire `ctv-management` folder to the new SSD path.
2. After the copy finishes, open the new folder and confirm `.git` exists.
3. Run:
   - `git status --short --branch`
4. Confirm you still see:
   - branch `codex/repo-hygiene-safe-verify`
   - the unstaged change in `src/lib/google-sheet-sync.ts`
5. Run:
   - `npm run verify:safe`
   - optional on NTFS/internal SSD: `npm run verify:full`

## What to send Codex after the move

Send a short message with:

1. the new absolute path of the repo
2. output of `git status --short --branch`
3. whether `.env.local` was copied
4. whether `npm run verify:safe` passed
5. whether `npm run verify:full` passed or failed

Example:

```text
Repo moi o D:\Projects\ctv-management.
git status:
## codex/repo-hygiene-safe-verify...origin/codex/repo-hygiene-safe-verify
 M src/lib/google-sheet-sync.ts
verify:safe da pass.
verify:full chua chay.
```

## Next work planned after the move

1. Continue optimization with focus on runtime/database hotspots and Nile quota safety.
2. Review import/export risk around `xlsx` (`npm audit` currently reports one high-severity advisory with no upstream fix).
3. Trim local workspace weight further if needed by removing old backup folders from the parent directory.
4. If full builds remain necessary on the external drive, consider reformatting that drive to `NTFS` or moving the repo to an internal SSD path.
