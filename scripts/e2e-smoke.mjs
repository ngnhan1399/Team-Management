import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const projectRoot = process.cwd();
const port = process.env.E2E_PORT || "3100";
const explicitBaseUrl = process.env.E2E_BASE_URL;
const baseUrl = explicitBaseUrl || `http://localhost:${port}`;
const requestOrigin = new URL(baseUrl).origin;
const loginEmail = process.env.E2E_ADMIN_EMAIL || "admin@demo.local";
const loginPassword = process.env.E2E_ADMIN_PASSWORD || "change-me-before-e2e";
const changedLoginPassword = process.env.E2E_CHANGED_ADMIN_PASSWORD || "change-me-after-first-login";

let serverProcess = null;
let serverOutput = "";

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function serverCommand() {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm run start"],
    };
  }

  return {
    command: npmCommand(),
    args: ["run", "start"],
  };
}

function appendServerOutput(chunk) {
  serverOutput += chunk.toString();
  if (serverOutput.length > 8000) {
    serverOutput = serverOutput.slice(-8000);
  }
}

async function waitForServer(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(2000),
      });

      if (response.status < 500) {
        return;
      }
    } catch {
      // Keep retrying until the timeout expires.
    }

    await delay(1000);
  }

  throw new Error(`Server did not become ready at ${url} within ${timeoutMs}ms.\n${serverOutput}`);
}

async function startServer() {
  if (explicitBaseUrl) return;

  const { command, args } = serverCommand();

  serverProcess = spawn(command, args, {
    cwd: projectRoot,
    env: { ...process.env, PORT: port },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout?.on("data", appendServerOutput);
  serverProcess.stderr?.on("data", appendServerOutput);
  serverProcess.on("exit", (code) => {
    if (code !== 0) {
      serverOutput += `\nServer exited early with code ${code}.`;
    }
  });

  await waitForServer(baseUrl);
}

function stopServer() {
  if (!serverProcess || serverProcess.killed) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(serverProcess.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }

  serverProcess.kill("SIGTERM");
}

function unique(items) {
  return [...new Set(items)];
}

function originHeaders() {
  return { Origin: requestOrigin };
}

async function launchBrowser() {
  const preferredChannel = process.env.PLAYWRIGHT_CHANNEL || "chrome";

  try {
    return await chromium.launch({
      channel: preferredChannel,
      headless: true,
    });
  } catch (error) {
    if (process.env.PLAYWRIGHT_CHANNEL) {
      throw error;
    }

    return chromium.launch({ headless: true });
  }
}

async function expectJsonOk(response, label) {
  assert.equal(response.ok(), true, `${label} failed with status ${response.status()}`);
  const data = await response.json();
  assert.equal(data.success, true, `${label} returned success=false: ${JSON.stringify(data)}`);
  return data;
}

async function waitForPostLoginScreen(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  const dashboardHeading = page.getByRole("heading", { name: /Chào buổi/i });
  const changePasswordHeading = page.getByRole("heading", { name: /Đổi mật khẩu/i });

  while (Date.now() < deadline) {
    if (await dashboardHeading.isVisible().catch(() => false)) return "dashboard";
    if (await changePasswordHeading.isVisible().catch(() => false)) return "change-password";
    await delay(250);
  }

  throw new Error("Post-login screen did not become ready in time.");
}

async function ensureSmokeArticle(request, baseUrl, writerPenName) {
  const timestamp = Date.now();
  const payload = await expectJsonOk(
    await request.post(`${baseUrl}/api/articles`, {
      headers: originHeaders(),
      data: {
        articleId: `E2E-${timestamp}`,
        date: new Date().toISOString().slice(0, 10),
        title: `E2E generated article ${timestamp}`,
        penName: writerPenName,
        category: "ICT",
        articleType: "Bài SEO ICT",
        contentType: "Viết mới",
        status: "Published",
        link: `https://example.com/e2e-${timestamp}`,
        notes: "Created by e2e smoke",
      },
    }),
    "Create fallback article"
  );

  return payload.id;
}

async function main() {
  await startServer();

  const browser = await launchBrowser();

  const page = await browser.newPage();
  const request = page.context().request;
  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  page.on("response", (response) => {
    const url = response.url();
    if (!url.startsWith(baseUrl)) return;
    if (response.status() < 400) return;

    const parsed = new URL(url);
    failedResponses.push(`[${response.status()}] ${parsed.pathname}${parsed.search}`);
  });

  const sections = [
    { testId: "nav-notifications", nav: "Thông báo", heading: /Thông báo/i },
    { testId: "nav-articles", nav: "Bài viết", heading: /Quản lý bài viết/i },
    { testId: "nav-tasks", nav: "Lịch biên tập", heading: /Lịch biên tập/i },
    { testId: "nav-team", nav: "Đội ngũ", heading: /Đội ngũ/i },
    { testId: "nav-royalty", nav: "Nhuận bút", heading: /Nhuận bút/i },
    { testId: "nav-audit", nav: "Audit Logs", heading: /Audit Logs/i },
    { testId: "nav-dashboard", nav: "Tổng quan", heading: /Chào buổi/i },
  ];

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("admin@demo.local").waitFor({ timeout: 30000 });

    await page.getByPlaceholder("admin@demo.local").fill(loginEmail);
    await page.getByPlaceholder("••••••••").fill(loginPassword);

    const loginResponse = page.waitForResponse((response) =>
      response.url().startsWith(`${baseUrl}/api/auth/login`) &&
      response.request().method() === "POST"
    );

    await page.getByRole("button", { name: /Đăng nhập hệ thống/i }).click();

      const loginResult = await loginResponse;
      assert.equal(loginResult.ok(), true, `Login failed with status ${loginResult.status()}`);

      const postLoginScreen = await waitForPostLoginScreen(page);
      if (postLoginScreen === "change-password") {
        const changePasswordResponse = page.waitForResponse((response) =>
          response.url().startsWith(`${baseUrl}/api/auth/change-password`) &&
          response.request().method() === "POST"
        );

        await page.getByPlaceholder("Tối thiểu 6 ký tự").fill(changedLoginPassword);
        await page.getByPlaceholder("Nhập lại mật khẩu").fill(changedLoginPassword);
        await page.getByRole("button", { name: /Đổi mật khẩu/i }).click();

        const changePasswordResult = await changePasswordResponse;
        assert.equal(changePasswordResult.ok(), true, `Change password failed with status ${changePasswordResult.status()}`);
        await page.getByRole("heading", { name: /Chào buổi/i }).waitFor({ timeout: 15000 });
      }

      const collaboratorsPayload = await expectJsonOk(
        await request.get(`${baseUrl}/api/collaborators`),
        "Fetch collaborators"
      );
      const writers = (collaboratorsPayload.data || []).filter((item) => item.role === "writer");
      assert.equal(writers.length > 0, true, "No writer collaborators found for E2E smoke");

      let articlesPayload = await expectJsonOk(
        await request.get(`${baseUrl}/api/articles?page=1&limit=30`),
        "Fetch articles"
      );
      let seededArticles = articlesPayload.data || [];
      let targetWriter = writers[0];

      if (seededArticles.length === 0) {
        await ensureSmokeArticle(request, baseUrl, targetWriter.penName);
        articlesPayload = await expectJsonOk(
          await request.get(`${baseUrl}/api/articles?page=1&limit=30`),
          "Refetch articles after fallback create"
        );
        seededArticles = articlesPayload.data || [];
      }

      assert.equal(seededArticles.length > 0, true, "No articles found for E2E smoke");

      let targetArticle = seededArticles[0];
      targetWriter = writers.find((writer) => writer.penName === targetArticle.penName) || writers[0];

      let royaltyDashboardPayload = await expectJsonOk(
        await request.get(`${baseUrl}/api/royalty?action=dashboard`),
        "Fetch royalty dashboard"
      );
      let royaltyDashboard = royaltyDashboardPayload.data;
      assert.equal(Boolean(royaltyDashboard?.currentMonth), true, "Missing currentMonth in royalty dashboard");

      if ((royaltyDashboard?.currentMonth?.totalArticles || 0) === 0 || (royaltyDashboard?.topWriters || []).length === 0) {
        const fallbackArticleId = await ensureSmokeArticle(request, baseUrl, targetWriter.penName);

        articlesPayload = await expectJsonOk(
          await request.get(`${baseUrl}/api/articles?page=1&limit=30`),
          "Refetch articles for fallback payment flow"
        );
        seededArticles = articlesPayload.data || [];
        targetArticle = seededArticles.find((article) => article.id === fallbackArticleId) || seededArticles[0];

        royaltyDashboardPayload = await expectJsonOk(
          await request.get(`${baseUrl}/api/royalty?action=dashboard`),
          "Refetch royalty dashboard after fallback create"
        );
        royaltyDashboard = royaltyDashboardPayload.data;
      }

      assert.equal((royaltyDashboard?.currentMonth?.totalArticles || 0) > 0, true, "Royalty dashboard has no current-month articles for payment flow");
      assert.equal((royaltyDashboard?.topWriters || []).length > 0, true, "Royalty dashboard has no top writers for payment flow");

      const paymentMonth = royaltyDashboard.currentMonth.month;
      const paymentYear = royaltyDashboard.currentMonth.year;
      const paymentPenName = royaltyDashboard.topWriters[0].penName;
      const timestamp = Date.now();
      const taskTitle = `E2E task ${timestamp}`;
      const commentText = `E2E comment ${timestamp}`;

      const createTaskPayload = await expectJsonOk(
        await request.post(`${baseUrl}/api/editorial-tasks`, {
          headers: originHeaders(),
          data: {
            title: taskTitle,
            description: "Created by smoke test",
            assigneePenName: targetWriter.penName,
            dueDate: new Date().toISOString().slice(0, 10),
            status: "todo",
            priority: "medium",
          },
        }),
        "Create editorial task"
      );
      const taskId = createTaskPayload.id;

      await expectJsonOk(
        await request.post(`${baseUrl}/api/articles/comments`, {
          headers: originHeaders(),
          data: {
            articleId: targetArticle.id,
            content: commentText,
            attachmentUrl: `https://example.com/e2e-${timestamp}`,
          },
        }),
        "Create article comment"
      );

      await expectJsonOk(
        await request.post(`${baseUrl}/api/payments`, {
          headers: originHeaders(),
          data: {
            action: "generate",
            month: paymentMonth,
            year: paymentYear,
            penName: paymentPenName,
            force: true,
          },
        }),
        "Generate payments"
      );

      const paymentsPayload = await expectJsonOk(
        await request.get(`${baseUrl}/api/payments?month=${paymentMonth}&year=${paymentYear}&penName=${encodeURIComponent(paymentPenName)}`),
        "Fetch payments"
      );
      const targetPayment = (paymentsPayload.data || []).find((payment) => payment.status === "pending");
      assert.notEqual(targetPayment, undefined, "No pending payment found after generation");

      for (const section of sections) {
        await page.getByTestId(section.testId).click();
        await page.getByRole("heading", { name: section.heading }).waitFor({ timeout: 15000 });
      }

      await page.getByTestId("nav-tasks").click();
      await page.getByRole("heading", { name: /Lịch biên tập/i }).waitFor({ timeout: 15000 });
      await page.getByTestId(`task-row-${taskId}`).waitFor({ timeout: 15000 });
      await page.getByTestId(`task-row-${taskId}`).getByText(taskTitle).waitFor({ timeout: 15000 });
      await page.getByTestId(`task-status-${taskId}`).selectOption("done");
      await page.getByTestId(`task-status-badge-${taskId}`).getByText("Hoàn thành").waitFor({ timeout: 15000 });

      await page.getByTestId("nav-articles").click();
      await page.getByRole("heading", { name: /Quản lý bài viết/i }).waitFor({ timeout: 15000 });
      await page.getByTestId("articles-search").fill(targetArticle.title);
      await page.getByTestId("articles-search").press("Enter");
      await page.getByTestId(`article-row-${targetArticle.id}`).waitFor({ timeout: 15000 });
      await page.getByTestId(`article-comment-${targetArticle.id}`).click();
      await page.getByRole("heading", { name: /Trao đổi bài viết/i }).waitFor({ timeout: 15000 });
      await page.getByText(commentText, { exact: false }).waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: /close/i }).click();

      await page.getByTestId("nav-royalty").click();
      await page.getByRole("heading", { name: /Nhuận bút/i }).waitFor({ timeout: 15000 });
      await page.getByTestId("royalty-tab-workflow").click();
      await page.getByTestId("payment-month-select").selectOption(String(paymentMonth));
      await page.getByTestId("payment-year-select").selectOption(String(paymentYear));
      await page.getByTestId("payment-penname-select").selectOption(paymentPenName);
      await page.getByTestId("payment-refresh-button").click();
      await page.getByTestId(`payment-row-${targetPayment.id}`).waitFor({ timeout: 15000 });
      await page.getByTestId(`payment-approve-${targetPayment.id}`).click();
      await page.getByTestId(`payment-status-badge-${targetPayment.id}`).getByText("Đã duyệt").waitFor({ timeout: 15000 });
      await page.getByTestId(`payment-mark-paid-${targetPayment.id}`).click();
      await page.getByTestId(`payment-status-badge-${targetPayment.id}`).getByText("Đã thanh toán").waitFor({ timeout: 15000 });

      const uniqueFailedResponses = unique(failedResponses);
      const uniqueConsoleErrors = unique(consoleErrors);
      const uniquePageErrors = unique(pageErrors);

    assert.equal(uniqueFailedResponses.length, 0, `Unexpected failed responses:\n${uniqueFailedResponses.join("\n")}`);
    assert.equal(uniqueConsoleErrors.length, 0, `Unexpected console errors:\n${uniqueConsoleErrors.join("\n")}`);
    assert.equal(uniquePageErrors.length, 0, `Unexpected page errors:\n${uniquePageErrors.join("\n")}`);

    console.log(`E2E smoke passed at ${baseUrl}`);
    console.log(`Checked sections: ${sections.map((section) => section.nav).join(", ")}`);
    console.log(`Mutations verified: task#${taskId}, article#${targetArticle.id} comment, payment#${targetPayment.id} approve+paid`);
  } finally {
    await page.close();
    await browser.close();
    stopServer();
  }
}

main().catch((error) => {
  stopServer();
  console.error(error);
  process.exitCode = 1;
});








