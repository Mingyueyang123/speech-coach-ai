import { expect, test } from "@playwright/test";

test("keeps the teleprompter mapped to the selected scenario", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "暂时跳过" }).click();

  await expect(page.getByRole("heading", { name: "投资人 Pitch", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "客户路演" }).first().click();
  await page.getByRole("button", { name: /第 2 轮关键词/ }).click();

  await expect(page.getByRole("heading", { name: "客户方案路演", level: 2 })).toBeVisible();
  await expect(page.getByText("1. 客户现状", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: /第 3 轮脱稿/ }).click();
  await expect(page.getByText("台词已隐藏")).toBeVisible();
});

test("switches the full practice chain to English", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "暂时跳过" }).click();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Investor Pitch", level: 2 })).toBeVisible();
  await expect(page.getByText("Hello, I am building an AI product", { exact: false })).toBeVisible();
});

test("turns one conversational message into a structured goal", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "暂时跳过" }).click();
  await page.getByRole("button", { name: "目标", exact: true }).click();
  await page.getByRole("textbox", { name: "描述训练目标" }).fill("下个月20号我要面对早期投资人做3分钟英文 Pitch，希望他们愿意约下一次会。");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("我已经整理好了", { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("早期投资人", { exact: false }).first()).toBeVisible();
});

test("records locally and never posts video or landmark data", async ({ page, context }) => {
  await context.grantPermissions(["camera", "microphone"], { origin: "http://127.0.0.1:3100" });
  const postedBodies: Array<{ url: string; body: string }> = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/")) {
      postedBodies.push({ url: request.url(), body: request.postData() ?? "" });
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "暂时跳过" }).click();
  await page.getByRole("button", { name: "用这段练习" }).click();
  await expect(page.getByRole("button", { name: "结束并复盘" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "收起摄像头" }).click();
  await expect(page.getByRole("heading", { name: "画面已收起 · 仍在录制" })).toBeVisible();
  await page.getByRole("button", { name: "展开摄像头" }).click();
  await page.waitForTimeout(1_200);
  await page.getByRole("button", { name: "结束并复盘" }).click();

  await expect(page.getByRole("heading", { name: "练习复盘", level: 1 })).toBeVisible({ timeout: 15_000 });
  expect(postedBodies.some(({ url }) => url.endsWith("/api/speech/session"))).toBeTruthy();
  for (const { body } of postedBodies) {
    expect(body).not.toContain("m=video");
    expect(body).not.toContain("faceLandmarks");
    expect(body).not.toContain("poseLandmarks");
    expect(body).not.toContain("videoBlob");
  }
});
