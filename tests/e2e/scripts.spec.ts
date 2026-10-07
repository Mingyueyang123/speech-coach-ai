import { expect, test } from "@playwright/test";

test("edits, restores and reloads a versioned script without changing other scenarios", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "暂时跳过" }).click();
  await page.getByRole("button", { name: "编辑台本", exact: true }).click();
  await page.getByLabel("编辑完整台本").fill("这是我自己的开场。\n\n这是我自己的收尾。");
  await page.getByRole("button", { name: "保存并用于练习" }).click();
  await expect(page.getByRole("status").filter({ hasText: "新版本已启用" })).toBeVisible();
  await page.getByTitle("关闭台本编辑").click();
  await expect(page.getByLabel("台词正文")).toContainText("这是我自己的开场");
  await page.reload();
  await expect(page.getByLabel("台词正文")).toContainText("这是我自己的开场");
  await page.getByRole("button", { name: "客户路演", exact: true }).click();
  await expect(page.getByLabel("台词正文")).not.toContainText("这是我自己的开场");
  await page.getByRole("button", { name: "投资人 Pitch", exact: true }).click();
  await expect(page.getByLabel("台词正文")).toContainText("这是我自己的开场");
});

test("generates from explicitly selected knowledge and previews before applying", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "暂时跳过" }).click();
  await page.getByRole("button", { name: "知识库", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "sample.txt", mimeType: "text/plain", buffer: Buffer.from("示例产品帮团队整理知识，证据需要现场补充。") });
  await expect(page.getByText("sample.txt", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "练习", exact: true }).click();
  await page.getByRole("button", { name: "从知识库生成", exact: true }).click();
  await page.getByRole("checkbox", { name: /sample.txt/ }).check();
  let request: Record<string, unknown> | undefined;
  await page.route("**/api/scripts/coach", async route => {
    request = route.request().postDataJSON();
    await route.fulfill({ json: { source: "ai", draft: { script: "从一个团队的知识整理问题开始，这是本轮新的表达。", cues: ["团队问题", "方案"], summary: "采用资料中的事实。" } } });
  });
  await page.getByRole("button", { name: "整理并生成台本" }).click();
  await expect(page.getByLabel("编辑完整台本")).toContainText("从一个团队");
  expect(request).not.toHaveProperty("videoBlob");
  expect((request?.sources as unknown[]).length).toBeLessThanOrEqual(6);
  await page.getByRole("button", { name: "保存并用于练习" }).click();
  await expect(page.getByRole("status").filter({ hasText: "新版本已启用" })).toBeVisible();
  await page.getByTitle("关闭台本编辑").click();
  await expect(page.getByLabel("台词正文")).toContainText("从一个团队");
});
