import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/157reP9SMWXgV47XHPcUJNqo1RicwS6vsqQvOlEW5F8Q/edit?gid=184624696#gid=184624696&range=A4874";
const outputPath = path.resolve(process.cwd(), process.argv[2] || "tmp/review-registration-google-state.json");
const outputBase64Path = path.resolve(
  process.cwd(),
  process.argv[3] || "tmp/review-registration-google-state.base64.txt",
);
const profileDir = path.resolve(process.cwd(), "tmp/review-registration-google-profile");
const waitTimeoutMs = 10 * 60 * 1000;
const waitPollMs = 3000;

const rl = input.isTTY ? readline.createInterface({ input, output }) : null;

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function resolveChromeExecutable() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // noop
    }
  }

  throw new Error("Không tìm thấy Chrome hoặc Edge trên máy để lưu phiên Google.");
}

function foldText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/gi, "d")
    .toLowerCase();
}

async function inspectEditorState(page) {
  const bodyText = foldText(await page.locator("body").innerText().catch(() => ""));
  const isLoggedOut = bodyText.includes("dang nhap");
  const isReadOnly = bodyText.includes("chi xem");
  const hasLoadedEnoughContent = bodyText.length > 200;

  return {
    bodyText,
    isLoggedOut,
    isReadOnly,
    hasLoadedEnoughContent,
    isEditorReady: hasLoadedEnoughContent && !isLoggedOut && !isReadOnly,
  };
}

async function waitForAuthorizedEditor(page) {
  const startedAt = Date.now();
  let readyStreak = 0;

  while (Date.now() - startedAt < waitTimeoutMs) {
    const state = await inspectEditorState(page);

    if (state.isEditorReady) {
      readyStreak += 1;
    } else {
      readyStreak = 0;
    }

    if (readyStreak >= 2 && Date.now() - startedAt >= 10_000) {
      return state;
    }

    await page.waitForTimeout(waitPollMs);
  }

  throw new Error("Hết thời gian chờ đăng nhập hoặc sheet vẫn chưa ở chế độ chỉnh sửa.");
}

async function waitForManualConfirmation(page) {
  if (!rl) {
    return waitForAuthorizedEditor(page);
  }

  while (true) {
    await rl.question("Sau khi đăng nhập xong và thấy sheet ở chế độ chỉnh sửa, hãy quay lại terminal rồi nhấn Enter: ");
    const state = await inspectEditorState(page);

    if (state.isEditorReady) {
      return state;
    }

    if (state.isLoggedOut) {
      output.write("\nHệ thống vẫn thấy trang ở trạng thái chưa đăng nhập. Trình duyệt sẽ tiếp tục mở để bạn đăng nhập lại.\n");
      continue;
    }

    if (state.isReadOnly) {
      output.write(
        "\nTài khoản hiện tại mới chỉ có quyền xem sheet, chưa có quyền chỉnh sửa. Hãy đổi đúng tài khoản rồi nhấn Enter lại.\n",
      );
      continue;
    }

    output.write("\nTrang chưa tải xong hoặc chưa vào đúng sheet chỉnh sửa. Hãy kiểm tra lại rồi nhấn Enter lại.\n");
  }
}

const executablePath = await resolveChromeExecutable();
await fs.mkdir(profileDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  executablePath,
  locale: "vi-VN",
  viewport: { width: 1440, height: 960 },
  headless: false,
  slowMo: 50,
  ignoreDefaultArgs: ["--enable-automation"],
  args: ["--disable-blink-features=AutomationControlled", "--disable-infobars"],
});

try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(SHEET_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

  output.write("\nĐăng nhập Google bằng tài khoản có quyền chỉnh sửa sheet “Việt Nguyễn”.\n");
  output.write(
    "Trình duyệt sẽ không tự đóng nữa. Sau khi đăng nhập xong và chắc chắn sheet đang ở chế độ chỉnh sửa, hãy quay lại terminal rồi nhấn Enter để lưu phiên.\n",
  );

  const editorState = await waitForManualConfirmation(page);
  if (editorState.isLoggedOut) {
    throw new Error("Phiên hiện tại vẫn đang ở trạng thái chưa đăng nhập.");
  }
  if (editorState.isReadOnly) {
    throw new Error("Tài khoản hiện tại mới chỉ có quyền xem sheet, chưa có quyền chỉnh sửa.");
  }

  const storageState = await context.storageState();
  const storageStateJson = JSON.stringify(storageState, null, 2);
  const storageStateBase64 = Buffer.from(storageStateJson, "utf8").toString("base64");

  await ensureParentDir(outputPath);
  await ensureParentDir(outputBase64Path);
  await fs.writeFile(outputPath, storageStateJson, "utf8");
  await fs.writeFile(outputBase64Path, storageStateBase64, "utf8");

  output.write(`\nĐã lưu storage state tại:\n- ${outputPath}\n- ${outputBase64Path}\n`);
  output.write("Bạn có thể dùng file JSON trực tiếp trên VPS hoặc dán base64 vào REVIEW_REGISTRATION_GOOGLE_STORAGE_STATE_BASE64.\n");
} finally {
  rl?.close();
  await context.close().catch(() => undefined);
}
