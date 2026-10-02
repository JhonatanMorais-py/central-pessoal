import { defineConfig } from "vite";

const DEMO_USER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "teste@local.dev",
  role: "authenticated",
};

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const demoToken = `${encode({ alg: "none", typ: "JWT" })}.${encode({
  sub: DEMO_USER.id,
  email: DEMO_USER.email,
  role: "authenticated",
  exp: Math.floor(Date.now() / 1000) + 86400,
})}.demo`;

function json(res, body, status = 200, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "content-range",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function demoSupabase() {
  const ideas = [];
  const finances = [];
  const tasks = [];
  const audios = new Map();
  return {
    name: "citracrm-demo",
    configureServer(server) {
      server.middlewares.use("/mock-supabase", async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        const path = url.pathname;
        if (req.method === "OPTIONS") return json(res, {});

        if (path === "/auth/v1/token" && req.method === "POST") {
          const payload = JSON.parse((await readBody(req)).toString() || "{}");
          if (
            payload.email !== DEMO_USER.email ||
            payload.password !== "teste123"
          ) {
            return json(
              res,
              { message: "Invalid login credentials" },
              400,
            );
          }
          return json(res, {
            access_token: demoToken,
            refresh_token: "demo-refresh-token",
            expires_in: 86400,
            token_type: "bearer",
            user: DEMO_USER,
          });
        }
        if (path === "/auth/v1/user") return json(res, DEMO_USER);
        if (path === "/auth/v1/logout") return json(res, {});

        if (path === "/rest/v1/cad_ideias") {
          if (req.method === "HEAD") {
            res.writeHead(200, {
              "content-range": `0-${Math.max(0, ideas.length - 1)}/${ideas.length}`,
              "access-control-allow-origin": "*",
              "access-control-expose-headers": "content-range",
            });
            return res.end();
          }
          if (req.method === "POST") {
            const input = JSON.parse((await readBody(req)).toString() || "{}");
            if (!ideas.some((idea) => idea.id === input.id)) {
              ideas.unshift({
                ...input,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                status: "pending",
                summary: null,
                prompt: null,
                error_message: null,
              });
            }
            return json(res, null, 201);
          }
          const from = Number(req.headers.range?.match(/(\d+)-/)?.[1] || 0);
          const to = Number(req.headers.range?.match(/-(\d+)/)?.[1] || from + 29);
          return json(res, ideas.slice(from, to + 1));
        }

        if (path === "/rest/v1/fin_lancamentos") {
          const id = url.searchParams.get("id")?.replace(/^eq\./, "");
          if (req.method === "POST") {
            const input = JSON.parse((await readBody(req)).toString() || "{}");
            const row = {
              id: input.id || crypto.randomUUID(),
              ...input,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            finances.unshift(row);
            return json(res, null, 201);
          }
          if (req.method === "PATCH") {
            const input = JSON.parse((await readBody(req)).toString() || "{}");
            const row = finances.find((item) => item.id === id);
            if (row)
              Object.assign(row, input, { updated_at: new Date().toISOString() });
            return json(res, null);
          }
          if (req.method === "DELETE") {
            const index = finances.findIndex((item) => item.id === id);
            if (index >= 0) finances.splice(index, 1);
            return json(res, null);
          }
          return json(
            res,
            [...finances].sort(
              (a, b) =>
                a.data_vencimento.localeCompare(b.data_vencimento) ||
                b.created_at.localeCompare(a.created_at),
            ),
          );
        }

        if (path === "/rest/v1/tarefas") {
          const id = url.searchParams.get("id")?.replace(/^eq\./, "");
          if (req.method === "POST") {
            const input = JSON.parse((await readBody(req)).toString() || "{}");
            tasks.unshift({
              id: input.id || crypto.randomUUID(),
              ...input,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            return json(res, null, 201);
          }
          if (req.method === "PATCH") {
            const input = JSON.parse((await readBody(req)).toString() || "{}");
            const row = tasks.find((item) => item.id === id);
            if (row)
              Object.assign(row, input, { updated_at: new Date().toISOString() });
            return json(res, null);
          }
          if (req.method === "DELETE") {
            const index = tasks.findIndex((item) => item.id === id);
            if (index >= 0) tasks.splice(index, 1);
            return json(res, null);
          }
          return json(res, tasks);
        }

        if (path.startsWith("/storage/v1/object/sign/audios/")) {
          const key = decodeURIComponent(
            path.replace("/storage/v1/object/sign/audios/", ""),
          );
          return json(res, {
            signedURL: `/mock-supabase/storage/v1/object/public-demo/${encodeURIComponent(key)}`,
          });
        }
        if (path.startsWith("/storage/v1/object/public-demo/")) {
          const key = decodeURIComponent(
            path.replace("/storage/v1/object/public-demo/", ""),
          );
          const audio = audios.get(key);
          if (!audio) return json(res, { message: "Not found" }, 404);
          res.writeHead(200, {
            "content-type": audio.type,
            "content-length": audio.data.length,
          });
          return res.end(audio.data);
        }
        if (path.startsWith("/storage/v1/object/audios/") && req.method === "POST") {
          const key = decodeURIComponent(
            path.replace("/storage/v1/object/audios/", ""),
          );
          const data = await readBody(req);
          audios.set(key, {
            data,
            type: req.headers["content-type"] || "audio/webm",
          });
          return json(res, { Key: key });
        }

        if (path === "/functions/v1/ideias" && req.method === "POST") {
          const input = JSON.parse((await readBody(req)).toString() || "{}");
          const index = ideas.findIndex((idea) => idea.id === input.id);
          if (input.action === "delete") {
            if (index >= 0) {
              const [removed] = ideas.splice(index, 1);
              if (removed.audio_path) audios.delete(removed.audio_path);
            }
            return json(res, { ok: true });
          }
          if (index < 0) return json(res, { error: "Ideia não encontrada." }, 404);
          const idea = ideas[index];
          if (input.action === "edit") {
            Object.assign(idea, {
              original_text: input.text.trim(),
              summary: null,
              prompt: null,
              status: "pending",
              updated_at: new Date().toISOString(),
            });
            return json(res, { ok: true });
          }
          if (input.action === "process") {
            idea.status = "generating";
            idea.original_text ||= "[Demonstração] Áudio recebido para transcrição.";
            idea.summary = `Resumo de demonstração: ${idea.original_text.slice(0, 220)}`;
            idea.prompt = input.generatePrompt
              ? `Objetivo\nOrganizar e implementar a ideia descrita abaixo.\n\nContexto\n${idea.original_text}\n\nComportamento esperado\nImplementar somente o que foi informado.\n\nRequisitos solicitados\n- Preservar o sentido da ideia original.\n\nRestrições mencionadas\nNão informado.\n\nCritérios de aceitação\n- A implementação corresponde à ideia registrada.\n\nDúvidas a esclarecer\n- Confirmar detalhes que não foram informados.`
              : null;
            idea.status = "ready";
            idea.updated_at = new Date().toISOString();
            return json(res, { ok: true });
          }
        }

        return json(res, { message: `Rota de demonstração ausente: ${path}` }, 404);
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: command === "serve" ? [demoSupabase()] : [],
}));
