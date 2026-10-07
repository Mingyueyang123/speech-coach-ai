import { expect, test } from "@playwright/test";

test("keeps the teleprompter mapped to the selected scenario", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "投资人 Pitch", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "客户方案路演" }).first().click();
  await page.getByRole("button", { name: "提纲" }).click();

  await expect(page.getByRole("heading", { name: "客户方案路演", level: 2 })).toBeVisible();
  await expect(page.getByText("1. 客户现状", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "隐藏" }).click();
  await expect(page.getByText("台词已隐藏")).toBeVisible();
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
  await page.getByRole("button", { name: "开始练习" }).click();
  await expect(page.getByRole("button", { name: "结束并复盘" })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_200);
  await page.getByRole("button", { name: "结束并复盘" }).click();

  await expect(page.getByRole("heading", { name: "练习复盘", level: 1 })).toBeVisible({ timeout: 15_000 });
  expect(postedBodies.some(({ url }) => url.endsWith("/api/realtime/session"))).toBeTruthy();
  for (const { body } of postedBodies) {
    expect(body).not.toContain("m=video");
    expect(body).not.toContain("faceLandmarks");
    expect(body).not.toContain("poseLandmarks");
    expect(body).not.toContain("videoBlob");
  }
});
