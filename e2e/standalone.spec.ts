import { expect, test } from "@playwright/test";

test("stand-alone carrega empresas e entra no painel", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText || "unknown";
    if (reason !== "net::ERR_ABORTED") {
      failedRequests.push(`${request.method()} ${request.url()}: ${reason}`);
    }
  });

  await page.goto("/");
  await expect(page.getByText("Selecione a empresa")).toBeVisible();
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "ANA Gaming" }).click();
  await page.getByRole("button", { name: /Entrar/i }).click();
  await expect(page.getByRole("heading", { name: "Módulos" })).toBeVisible();
  await page.waitForLoadState("networkidle");

  await page.goto("/compras");
  await expect(page.getByText("Gestão de Compras")).toBeVisible();
  await expect(page.getByText(/Sessão SAP não encontrada/i)).toHaveCount(0);

  if (testInfo.project.name === "mobile-chromium") {
    await page.goto("/cadastros/fornecedores");
    await expect(page.getByRole("heading", { name: "Fornecedores" })).toBeVisible();
    const hasViewportOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasViewportOverflow).toBe(false);

    const controls = await page.locator("main button:visible, main [role=button]:visible").evaluateAll(
      (elements) => elements.map((element) => element.getBoundingClientRect().height),
    );
    expect(controls.every((height) => height >= 44)).toBe(true);
  }
  expect(failedRequests).toEqual([]);
  expect(errors).toEqual([]);
});
