import { handler } from "../supabase/functions/ideias/handler.ts";
const uid = "11111111-1111-4111-8111-111111111111",
  id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const assert = (ok: unknown, message = "Falha de asserção") => {
  if (!ok) throw new Error(message);
};
Deno.test(
  "handler real: autenticação, propriedade, retry, transcrição persistida e exclusão parcial",
  async (t) => {
    Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
    Deno.env.set("SUPABASE_ANON_KEY", "public");
    Deno.env.set("GROQ_API_KEY", "test-only");
    Deno.env.set("ALLOWED_ORIGINS", "http://localhost:5173");
    const originalFetch = globalThis.fetch;
    let row: Record<string, unknown> | null;
    let groqFails = false,
      removeFails = false,
      dbDeleteFails = false,
      transcriptions = 0,
      processing = 0;
    const fresh = () => {
      row = {
        id,
        user_id: uid,
        source: "audio",
        audio_path: `${uid}/${id}.mp4`,
        original_text: null,
        status: "pending",
      };
      groqFails = false;
      removeFails = false;
      dbDeleteFails = false;
      transcriptions = 0;
      processing = 0;
    };
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input)),
        method = init?.method || "GET";
      const json = (value: unknown, status = 200) =>
        Promise.resolve(
          new Response(JSON.stringify(value), {
            status,
            headers: { "Content-Type": "application/json" },
          }),
        );
      if (url.pathname === "/auth/v1/user")
        return json({ id: uid, email: "eu@example.com" });
      if (url.pathname === "/rest/v1/rpc/claim_idea") {
        const body = JSON.parse(String(init?.body));
        if (row) row.lock_token = body.p_token;
        return json(row ? [row] : []);
      }
      if (url.pathname === "/rest/v1/cad_ideias") {
        if (method === "PATCH") {
          Object.assign(row!, JSON.parse(String(init?.body)));
          return json([{ id }]);
        }
        if (method === "DELETE") {
          if (dbDeleteFails) return json({ message: "db failure" }, 500);
          row = null;
          return json(null);
        }
        return json(row ? { id } : null);
      }
      if (url.pathname.startsWith("/storage/v1/object/")) {
        if (method === "DELETE")
          return json(
            removeFails ? { message: "storage failure" } : [],
            removeFails ? 500 : 200,
          );
        return new Response(
          new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 109, 112, 52, 50]),
          { headers: { "Content-Type": "audio/mp4" } },
        );
      }
      if (url.pathname.endsWith("/audio/transcriptions")) {
        transcriptions++;
        return json({
          text: "Minha ideia transcrita",
          duration: 10,
          segments: [{ text: "Minha ideia transcrita", avg_logprob: -0.1 }],
        });
      }
      if (url.pathname.endsWith("/chat/completions")) {
        processing++;
        if (groqFails) return json({ error: "quota" }, 429);
        const body = JSON.parse(String(init?.body));
        assert(
          body.messages[1].content.includes(String(row!.original_text)),
          "Deve usar texto persistido",
        );
        return json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  summary: "Resumo",
                  prompt: "Objetivo: implementar",
                }),
              },
            },
          ],
        });
      }
      throw new Error(`Endpoint inesperado ${url.pathname}`);
    };
    const request = (body: unknown, auth = true) =>
      new Request("https://edge.test/ideias", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: "Bearer user-token" } : {}),
        },
        body: JSON.stringify(body),
      });
    try {
      await t.step("sem token é 401", async () => {
        const res = await handler(request({ action: "process", id }, false));
        assert(res.status === 401);
      });
      await t.step("ideia de outro usuário não encontrada", async () => {
        row = null;
        const res = await handler(request({ action: "process", id }));
        assert(res.status === 404);
        assert(transcriptions === 0);
      });
      await t.step(
        "429 preserva transcrição e retry não retranscreve",
        async () => {
          fresh();
          groqFails = true;
          const failed = await handler(
            request({ action: "process", id, generatePrompt: true }),
          );
          assert(failed.status === 429);
          assert(row!.original_text === "Minha ideia transcrita");
          assert(row!.status === "error");
          assert(row!.audio_path);
          groqFails = false;
          const success = await handler(
            request({ action: "process", id, generatePrompt: true }),
          );
          assert(success.status === 200);
          assert(transcriptions === 1);
          assert(processing === 2);
          assert(row!.status === "ready");
          assert(row!.lock_token === null);
        },
      );
      await t.step("correção invalida derivados sem chamar Groq", async () => {
        const result = await handler(
          request({ action: "edit", id, text: "Texto corrigido" }),
        );
        assert(result.status === 200);
        assert(row!.original_text === "Texto corrigido");
        assert(row!.summary === null);
        assert(row!.prompt === null);
        assert(processing === 2);
      });
      await t.step(
        "falha ao remover áudio mantém registro para nova tentativa",
        async () => {
          removeFails = true;
          const result = await handler(request({ action: "delete", id }));
          assert(result.status === 503);
          assert(row !== null);
          assert(row!.status === "deleting");
          removeFails = false;
          dbDeleteFails = true;
          const partial = await handler(request({ action: "delete", id }));
          assert(partial.status === 503);
          assert(row !== null);
          assert(String(row!.error_message).includes("áudio foi removido"));
          dbDeleteFails = false;
          const success = await handler(request({ action: "delete", id }));
          assert(success.status === 200);
          assert(row === null);
          const repeat = await handler(request({ action: "delete", id }));
          assert(repeat.status === 200);
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);
