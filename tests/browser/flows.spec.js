import { test, expect } from "@playwright/test";
const uid = "11111111-1111-4111-8111-111111111111";
let rows, finances, processCalls, uploads;
test.beforeEach(async ({ page }) => {
  rows = [];
  finances = [];
  processCalls = [];
  uploads = [];
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://test.supabase.co/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const send = (data, status = 200, extra = {}) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "*",
          "access-control-expose-headers": "content-range",
          ...extra,
        },
        body: JSON.stringify(data),
      });
    if (url.pathname.endsWith("/token"))
      return send({
        access_token: "fake-token",
        refresh_token: "refresh",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: uid, email: "eu@example.com" },
      });
    if (url.pathname.endsWith("/logout")) return send({});
    if (url.pathname.startsWith("/rest/v1/cad_ideias")) {
      if (req.method() === "HEAD")
        return send(null, 200, { "content-range": `0-0/${rows.length}` });
      if (req.method() === "POST") {
        const row = req.postDataJSON();
        if (!rows.find((i) => i.id === row.id))
          rows.unshift({
            ...row,
            created_at: new Date().toISOString(),
            status: "pending",
          });
        return send(null, 201);
      }
      if (url.searchParams.get("select") === "status")
        return send({ status: "generating" });
      return send(rows);
    }
    if (url.pathname.startsWith("/rest/v1/fin_lancamentos")) {
      const id = url.searchParams.get("id")?.replace(/^eq\./, "");
      if (req.method() === "POST") {
        const input = req.postDataJSON();
        finances.unshift({
          id: crypto.randomUUID(),
          ...input,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return send(null, 201);
      }
      if (req.method() === "PATCH") {
        const row = finances.find((item) => item.id === id);
        if (row) Object.assign(row, req.postDataJSON());
        return send(null);
      }
      if (req.method() === "DELETE") {
        finances = finances.filter((item) => item.id !== id);
        return send(null);
      }
      return send(finances);
    }
    if (url.pathname.startsWith("/storage/v1/object/sign/"))
      return send({ signedURL: "/object/sign/audios/sample.webm?token=test" });
    if (url.pathname.startsWith("/storage/v1/object/")) {
      uploads.push(req.url());
      return send({ Key: "saved" });
    }
    if (url.pathname.endsWith("/functions/v1/ideias")) {
      const body = req.postDataJSON(),
        row = rows.find((i) => i.id === body.id);
      if (body.action === "process") {
        processCalls.push(body);
        if (row.original_text === "falhar" && processCalls.length === 1) {
          row.status = "error";
          row.error_message = "Cota atingida";
          return send({ error: "Cota atingida. Tente novamente." }, 429);
        }
        row.original_text ||= "Ideia transcrita em português.";
        row.summary = "Resumo da ideia";
        row.prompt = body.generatePrompt
          ? "Objetivo\nImplementar a ideia."
          : null;
        row.status = "ready";
        row.error_message = null;
      }
      if (body.action === "edit") {
        row.original_text = body.text;
        row.summary = null;
        row.prompt = null;
        row.status = "pending";
      }
      if (body.action === "delete") rows = rows.filter((i) => i.id !== body.id);
      return send({ ok: true });
    }
    return send({});
  });
  await page.goto("/");
  await page.getByLabel("E-mail", { exact: true }).fill("eu@example.com");
  await page.getByLabel("Senha", { exact: true }).fill("segredo123");
  await page.getByRole("button", { name: /Entrar no meu espaço/ }).click();
  await expect(page.getByText("Toda criação começa")).toBeVisible();
});
test("texto, prompt, cópia, correção, exclusão com confirmação e logout", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page
    .getByLabel("Escreva sua ideia")
    .fill("<img src=x onerror=alert(1)> Uma ideia pessoal");
  await page.getByRole("button", { name: "Salvar ideia" }).click();
  await expect(
    page.getByText("Ideia organizada e salva.", { exact: true }),
  ).toBeVisible();
  expect(rows).toHaveLength(1);
  expect(await page.locator(".idea img").count()).toBe(0);
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page
    .getByRole("button", { name: "Copiar prompt", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Implementar",
  );
  await page.getByRole("button", { name: "Corrigir texto" }).click();
  await page.getByLabel("Texto corrigido").fill("Versão corrigida");
  await page
    .getByRole("button", { name: "Salvar e gerar resumo + prompt" })
    .click();
  await expect(page.locator(".idea-text")).toHaveText("Versão corrigida");
  await expect(
    page.getByText("Ideia organizada e salva.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await page.getByRole("button", { name: "Manter ideia" }).click();
  expect(rows).toHaveLength(1);
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await page
    .getByRole("button", { name: "Excluir ideia", exact: true })
    .click();
  await expect(page.getByText("Toda criação começa")).toBeVisible();
  expect(rows).toHaveLength(0);
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
});
test("erro de IA preserva registro e retry não duplica", async ({ page }) => {
  await page.getByLabel("Escreva sua ideia").fill("falhar");
  await page.getByRole("button", { name: "Salvar ideia" }).click();
  await expect(
    page.getByText("Cota atingida. Tente novamente.", { exact: true }),
  ).toBeVisible();
  expect(rows).toHaveLength(1);
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(
    page.getByText("Ideia organizada e salva.", { exact: true }),
  ).toBeVisible();
  expect(rows).toHaveLength(1);
  expect(processCalls).toHaveLength(2);
});
test("gravação real no navegador com microfone sintético, limite, upload e transcrição", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Gravar áudio", exact: true }).click();
  await expect(page.getByText("Gravando sua ideia")).toBeVisible();
  await expect(page.locator("#audio-preview")).toBeVisible({ timeout: 7000 });
  expect(await page.locator("#draft-audio").getAttribute("src")).toMatch(
    /^blob:/,
  );
  const recordedBytes = await page.evaluate(async () =>
    Array.from(
      new Uint8Array(
        await (
          await fetch(document.querySelector("#draft-audio").src)
        ).arrayBuffer(),
      ),
    ),
  );
  await page.route("**/sample.webm?token=test", (r) =>
    r.fulfill({ contentType: "audio/webm", body: Buffer.from(recordedBytes) }),
  );
  await page.getByRole("button", { name: "Salvar ideia" }).click();
  await expect(
    page.getByText("Ideia organizada e salva.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Ouvir áudio original/ }).click();
  await expect
    .poll(() => page.locator(".idea audio").evaluate((a) => a.readyState))
    .toBeGreaterThan(1);
  expect(uploads).toHaveLength(1);
  expect(rows[0].source).toBe("audio");
  expect(rows[0].audio_path).toMatch(/\.webm$/);
  await expect(
    page.getByText("Ideia transcrita em português.", { exact: true }),
  ).toBeVisible();
});
test("cancelar gravação e layout móvel sem rolagem horizontal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Gravar áudio", exact: true }).click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.locator("#audio-preview")).toBeHidden();
  expect(rows).toHaveLength(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});

test("microfone negado mostra orientação sem perder texto", async ({
  page,
}) => {
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await page.getByRole("button", { name: "Gravar áudio", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("microfone foi negado");
  await expect(
    page.getByRole("button", { name: "Salvar ideia" }),
  ).toBeEnabled();
});
test("envio com resposta perdida repete o mesmo ID sem duplicar", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/rest/v1/cad_ideias?on_conflict*", async (route) => {
    const row = route.request().postDataJSON();
    calls++;
    if (!rows.find((i) => i.id === row.id))
      rows.unshift({
        ...row,
        created_at: new Date().toISOString(),
        status: "pending",
      });
    if (calls === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Conexão interrompida depois de salvar",
        }),
      });
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: "null",
    });
  });
  await page.getByLabel("Escreva sua ideia").fill("Minha ideia preservada");
  await page.getByRole("button", { name: "Salvar ideia" }).click();
  await expect(page.getByRole("status")).toContainText("Conexão interrompida");
  await page.getByRole("button", { name: "Salvar ideia" }).click();
  await expect(
    page.getByText("Ideia organizada e salva.", { exact: true }),
  ).toBeVisible();
  expect(rows).toHaveLength(1);
  expect(calls).toBe(2);
});

test("financeiro registra conta, realiza pagamento, filtra e exclui", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Financeiro/ }).click();
  await expect(page.getByRole("heading", { name: "Visão financeira" })).toBeVisible();
  await page.getByRole("button", { name: /Novo lançamento/ }).first().click();
  await page.getByLabel("Descrição").fill("Aluguel do escritório");
  await page.getByRole("radio", { name: /Saída/ }).check();
  await page.getByLabel("Valor").fill("1.250,50");
  await page.getByLabel("Vencimento").fill("2026-10-10");
  await page.getByLabel("Categoria").fill("Estrutura");
  await page.getByRole("button", { name: /Salvar lançamento/ }).click();

  expect(finances).toHaveLength(1);
  await expect(page.getByText("A pagar", { exact: true })).toBeVisible();
  await expect(page.locator("#summary-pending")).toHaveText("R$ 1.250,50");

  await page.getByRole("button", { name: "Marcar pago" }).click();
  await expect(page.getByText("Pago", { exact: true })).toBeVisible();
  await expect(page.locator("#summary-balance")).toHaveText("-R$ 1.250,50");
  await page.screenshot({ path: "test-results/finance-desktop.png", fullPage: true });

  await page.getByPlaceholder("Buscar descrição…").fill("inexistente");
  await expect(
    page.getByText("Nenhum lançamento corresponde aos filtros."),
  ).toBeVisible();
  await page.getByPlaceholder("Buscar descrição…").fill("");

  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await page.getByRole("button", { name: "Manter lançamento" }).click();
  expect(finances).toHaveLength(1);
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await page.getByRole("button", { name: "Excluir lançamento" }).click();
  await expect(page.getByText("Seu financeiro começa com um lançamento.")).toBeVisible();
  expect(finances).toHaveLength(0);
});
