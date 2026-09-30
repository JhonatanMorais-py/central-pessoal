import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import {
  validateAudio,
  transcriptionText,
  validateGeneration,
  systemPrompt,
} from "../_shared/validation.js";

const env = (name: string, fallback = "") => Deno.env.get(name) || fallback;
class PublicError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const positive = (name: string, fallback: number) => {
  const n = Number(env(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export async function handler(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = env("ALLOWED_ORIGINS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Vary: "Origin",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  if (origin && !allowed.includes(origin))
    return reply(
      { error: "Origem não autorizada. Configure ALLOWED_ORIGINS." },
      403,
    );
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST")
    return reply({ error: "Método não permitido." }, 405);
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer "))
    return reply({ error: "Entre na sua conta para continuar." }, 401);
  let publicKey = env("SUPABASE_ANON_KEY");
  try {
    publicKey =
      JSON.parse(env("SUPABASE_PUBLISHABLE_KEYS", "{}")).default || publicKey;
  } catch {
    /* fallback para ambiente legado */
  }
  if (!env("SUPABASE_URL") || !publicKey)
    return reply({ error: "Configuração do Supabase indisponível." }, 503);
  const supabase = createClient(env("SUPABASE_URL"), publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let id: string | undefined, token: string | undefined;
  let action = "";
  async function save(values: Record<string, unknown>) {
    const { data, error } = await supabase
      .from("cad_ideias")
      .update(values)
      .eq("id", id!)
      .eq("lock_token", token!)
      .select("id");
    if (error || !data?.length)
      throw new PublicError(
        "Não foi possível salvar o resultado. Sua ideia original foi preservada; tente novamente.",
        503,
      );
  }
  async function groq(endpoint: string, body: FormData | string) {
    const key = env("GROQ_API_KEY");
    if (!key)
      throw new PublicError(
        "A integração com a IA ainda não foi configurada.",
        503,
      );
    let response: Response;
    try {
      response = await fetch(`https://api.groq.com/openai/v1/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          ...(typeof body === "string"
            ? { "Content-Type": "application/json" }
            : {}),
        },
        body,
        signal: AbortSignal.timeout(55000),
      });
    } catch {
      throw new PublicError(
        "A IA demorou ou a conexão falhou. Sua ideia está salva; tente novamente.",
        503,
      );
    }
    if (response.status === 429)
      throw new PublicError(
        "A cota ou o limite de requisições da Groq foi atingido. Aguarde e consulte os limites da sua conta antes de tentar novamente.",
        429,
      );
    if (!response.ok)
      throw new PublicError(
        response.status === 413
          ? "O áudio ultrapassa o limite aceito pela Groq."
          : response.status === 401 || response.status === 403
            ? "Verifique a chave da Groq e as permissões do modelo configurado."
            : "A Groq não conseguiu processar esta ideia. Confira o modelo e tente novamente mais tarde.",
        502,
      );
    try {
      return await response.json();
    } catch {
      throw new PublicError(
        "A IA retornou uma resposta inválida. Tente novamente.",
        502,
      );
    }
  }
  try {
    const { data: auth, error: authError } = await supabase.auth.getUser(
      authorization.slice(7),
    );
    if (authError || !auth.user)
      return reply({ error: "Sua sessão expirou. Entre novamente." }, 401);
    const raw = await req.text();
    if (raw.length > 25000)
      throw new PublicError("Solicitação muito grande.", 413);
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new PublicError("Solicitação inválida.");
    }
    action = input.action;
    id = input.id;
    if (
      !["process", "edit", "delete"].includes(action) ||
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new PublicError("Ação ou ideia inválida.");
    if (
      action === "edit" &&
      (typeof input.text !== "string" ||
        !input.text.trim() ||
        input.text.length > 20000)
    )
      throw new PublicError("Informe um texto entre 1 e 20.000 caracteres.");
    const { data: existing, error: readError } = await supabase
      .from("cad_ideias")
      .select("id")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (readError)
      throw new PublicError("Não foi possível consultar a ideia.", 503);
    if (!existing)
      return action === "delete"
        ? reply({ ok: true })
        : reply({ error: "Ideia não encontrada." }, 404);
    const claimToken = crypto.randomUUID();
    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_idea",
      { p_id: id, p_token: claimToken },
    );
    if (claimError)
      throw new PublicError("Não foi possível iniciar o processamento.", 503);
    const idea = claimed?.[0];
    if (!idea)
      throw new PublicError(
        "Esta ideia já está sendo processada. Aguarde até três minutos e tente novamente.",
        409,
      );
    token = claimToken;
    if (
      idea.audio_path &&
      !new RegExp(`^${auth.user.id}/${id}\\.(webm|mp4|ogg)$`).test(
        idea.audio_path,
      )
    )
      throw new PublicError("Caminho de áudio inválido.");
    if (action === "delete") {
      await save({ status: "deleting", error_message: null });
      if (idea.audio_path) {
        // Storage remove é idempotente para objeto já ausente.
        const { error } = await supabase.storage
          .from("audios")
          .remove([idea.audio_path]);
        if (error)
          throw new PublicError(
            "Não foi possível excluir o áudio. O registro foi mantido; tente excluir novamente.",
            503,
          );
      }
      const { error } = await supabase
        .from("cad_ideias")
        .delete()
        .eq("id", id)
        .eq("lock_token", token);
      if (error)
        throw new PublicError(
          "O áudio foi removido, mas o registro ainda existe. Tente excluir novamente para concluir.",
          503,
        );
      return reply({ ok: true });
    }
    if (action === "edit") {
      await save({
        original_text: input.text.trim(),
        summary: null,
        prompt: null,
        status: "pending",
        error_message: null,
        locked_until: null,
        lock_token: null,
      });
      return reply({ ok: true });
    }
    const generate = input.generatePrompt === true;
    await save({
      status:
        idea.source === "audio" && !idea.original_text
          ? "transcribing"
          : "generating",
      generate_prompt: generate,
      error_message: null,
    });
    let text = idea.original_text;
    if (idea.source === "audio" && !text) {
      const { data: audio, error } = await supabase.storage
        .from("audios")
        .download(idea.audio_path);
      if (error || !audio)
        throw new PublicError(
          "Não foi possível acessar o áudio original. Tente novamente.",
          503,
        );
      const maxBytes = Math.min(
        positive("MAX_AUDIO_BYTES", 25_000_000),
        25_000_000,
      );
      if (audio.size > maxBytes)
        throw new PublicError("O áudio ultrapassa o limite configurado.");
      try {
        validateAudio(
          new Uint8Array(await audio.arrayBuffer()),
          audio.type,
          idea.audio_path,
          maxBytes,
        );
      } catch (e) {
        throw new PublicError((e as Error).message);
      }
      const form = new FormData();
      form.set("file", audio, idea.audio_path.split("/").pop());
      form.set(
        "model",
        env("GROQ_TRANSCRIPTION_MODEL", "whisper-large-v3-turbo"),
      );
      form.set("language", "pt");
      form.set("response_format", "verbose_json");
      form.set("temperature", "0");
      const transcript = await groq("audio/transcriptions", form);
      text = transcriptionText(transcript);
      if (!text)
        throw new PublicError(
          "Não foi possível reconhecer fala. Ouça o áudio e tente novamente.",
        );
      if (text.length > 20000)
        throw new PublicError(
          "A transcrição excedeu 20.000 caracteres. O áudio original está preservado.",
        );
      // Persiste antes da etapa de geração; novas tentativas reutilizam esta versão.
      await save({ original_text: text, status: "generating" });
      if (
        Number(transcript.duration) >
        positive("MAX_RECORDING_SECONDS", 300) + 2
      )
        throw new PublicError(
          "O áudio excede a duração configurada. A transcrição foi preservada para revisão.",
        );
    }
    if (!text?.trim())
      throw new PublicError("A ideia precisa de texto para gerar um resumo.");
    const generated = await groq(
      "chat/completions",
      JSON.stringify({
        model: env("GROQ_TEXT_MODEL", "openai/gpt-oss-20b"),
        temperature: 0.2,
        max_completion_tokens: 6000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(generate) },
          { role: "user", content: JSON.stringify({ ideia: text }) },
        ],
      }),
    );
    if (generated.choices?.[0]?.finish_reason !== "stop")
      throw new PublicError(
        "A resposta da IA foi interrompida. Sua ideia foi preservada; tente novamente.",
        502,
      );
    let result;
    try {
      result = validateGeneration(
        JSON.parse(generated.choices[0].message.content),
        generate,
      );
    } catch {
      throw new PublicError(
        "A IA retornou um formato incompleto. Sua ideia foi preservada; tente novamente.",
        502,
      );
    }
    await save({
      ...result,
      status: "ready",
      error_message: null,
      locked_until: null,
      lock_token: null,
    });
    return reply({ ok: true });
  } catch (e) {
    const message =
      e instanceof PublicError
        ? e.message
        : "Falha inesperada. Sua ideia foi preservada; tente novamente.";
    if (id && token) {
      // Nunca registrar chave, áudio, transcrição ou resposta privada nos logs.
      await supabase
        .from("cad_ideias")
        .update({
          status: action === "delete" ? "deleting" : "error",
          error_message: message,
          locked_until: null,
          lock_token: null,
        })
        .eq("id", id)
        .eq("lock_token", token);
    }
    return reply({ error: message }, e instanceof PublicError ? e.status : 500);
  }
}
