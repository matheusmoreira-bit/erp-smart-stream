import { expect, test } from "@playwright/test";

test("stand-alone carrega empresas e entra no painel", async ({ page }) => {
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
  await expect(page.getByText("Painel de gestão")).toBeVisible();

  await page.goto("/compras");
  await expect(page.getByText("Gestão de Compras")).toBeVisible();
  await expect(page.getByText(/Sessão SAP não encontrada/i)).toHaveCount(0);
  expect(failedRequests).toEqual([]);
  expect(errors).toEqual([]);
});
