import { createClient } from "@supabase/supabase-js";
import "./style.css";
import { recordingFormat, extension, clock, friendlyError } from "./core.js";
import { createFinanceController } from "./finance.js";
import { createTaskController } from "./tasks.js";
const $ = (id) => document.getElementById(id);
const config = {
  url: import.meta.env.VITE_SUPABASE_URL,
  key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
};
const configured =
  (config.url?.startsWith("https://") ||
    config.url?.startsWith("http://localhost")) &&
  config.key &&
  !config.url.includes("SEU-PROJETO");
const client = configured ? createClient(config.url, config.key) : null;
const aiEnabled = import.meta.env.VITE_AI_ENABLED !== "false";
const maxSeconds = Math.max(
  1,
  Number(import.meta.env.VITE_MAX_RECORDING_SECONDS) || 300,
);
const MAX_BYTES = 25000000;
let user,
  busy = false,
  recorder,
  stream,
  timer,
  started,
  cancelled = false,
  blob,
  blobUrl,
  draftId,
  uploadedPath;
let ideas = [],
  offset = 0,
  deleteId,
  authVersion = 0,
  activeView = "ideas";
function notice(text, error = false) {
  $("notice").textContent = text;
  $("notice").dataset.error = error;
  $("notice").hidden = !text;
}
function lock(value) {
  busy = value;
  document
    .querySelectorAll(
      "#workspace button, #workspace textarea, #workspace input, #logout",
    )
    .forEach((el) => (el.disabled = value));
  if (!value) {
    $("idea-text").disabled = !!blob || recorder?.state === "recording";
    $("send").disabled = recorder?.state === "recording";
  }
}
async function run(work) {
  if (busy) return;
  if (recorder?.state === "recording") {
    notice("Pare ou cancele a gravação antes de continuar.");
    return;
  }
  lock(true);
  try {
    await work();
  } catch (e) {
    notice(friendlyError(e), true);
  } finally {
    lock(false);
  }
}
function check(result) {
  if (result.error) throw result.error;
  return result.data;
}
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(label, fn, className = "text-button") {
  const node = el("button", label, className);
  node.type = "button";
  node.onclick = () => run(fn);
  return node;
}
const finance = createFinanceController({ client, check, notice, run });
const tasks = createTaskController({ client, check, notice, run });

const viewCopy = {
  ideas: {
    eyebrow: "CAPTURE. ORGANIZE. CRIE.",
    title: "Dê espaço às suas ideias.",
    subtitle: "Do pensamento solto ao próximo projeto. Uma ideia de cada vez.",
    art: "ideas",
    topbar: "Seu caderno, com um próximo passo.",
    quote: "Uma ideia não precisa estar pronta para ser boa.",
    detail: "Comece pelo que está na sua cabeça.",
    footer: "Da sua cabeça para o mundo.",
  },
  finance: {
    eyebrow: "REGISTRE. ACOMPANHE. DECIDA.",
    title: "Clareza para suas finanças.",
    subtitle: "Entradas, saídas e compromissos reunidos em um só lugar.",
    art: "finance",
    topbar: "Seu dinheiro, com contexto e direção.",
    quote: "Organizar o dinheiro também é criar espaço.",
    detail: "Registre hoje para decidir melhor amanhã.",
    footer: "Clareza para escolher o próximo passo.",
  },
  tasks: {
    eyebrow: "PLANEJE. EXECUTE. CONCLUA.",
    title: "Organize suas tarefas.",
    subtitle: "Registre o que precisa ser feito e acompanhe cada conclusão.",
    art: "tasks",
    topbar: "Seu trabalho, organizado por próximos passos.",
    quote: "Uma tarefa clara deixa o próximo passo mais leve.",
    detail: "Registre, conclua e siga em frente.",
    footer: "Um passo de cada vez.",
  },
};

async function switchView(view) {
  if (!viewCopy[view] || view === activeView) return;
  activeView = view;
  document
    .querySelectorAll(".module-link")
    .forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $("ideas-workspace").hidden = view !== "ideas";
  $("finance-workspace").hidden = view !== "finance";
  $("tasks-workspace").hidden = view !== "tasks";
  $("new-idea").hidden = view !== "ideas";
  $("new-finance").hidden = view !== "finance";
  $("new-task").hidden = view !== "tasks";
  const copy = viewCopy[view];
  $("heading-eyebrow").textContent = copy.eyebrow;
  $("heading-title").replaceChildren(
    document.createTextNode(copy.title.slice(0, -1)),
    el("span", "."),
  );
  $("heading-subtitle").textContent = copy.subtitle;
  $("heading-art").className = `heading-art ${copy.art}`;
  $("topbar-copy").textContent = copy.topbar;
  $("sidebar-quote").textContent = copy.quote;
  $("sidebar-quote-detail").textContent = copy.detail;
  $("workspace-footer").textContent = copy.footer;
  notice("");
  if (view === "finance" && user) await finance.refresh();
  if (view === "tasks" && user) await tasks.refresh();
}
async function invoke(body) {
  const { data, error } = await client.functions.invoke("ideias", { body });
  if (error) {
    let message =
      "Não foi possível processar. Sua ideia continua salva; tente novamente.";
    try {
      const json = await error.context?.json();
      if (json?.error) message = json.error;
    } catch {
      /* resposta de rede sem JSON */
    }
    throw new Error(message);
  }
  return data;
}
async function refresh(more = false) {
  const version = authVersion;
  const start = more ? offset : 0;
  const data = check(
    await client
      .from("cad_ideias")
      .select("*")
      .order("created_at", { ascending: false })
      .range(start, start + 29),
  );
  if (version !== authVersion || !user) return;
  ideas = more ? [...ideas, ...data] : data;
  offset = ideas.length;
  $("load-more").hidden = data.length < 30;
  const { count, error } = await client
    .from("cad_ideias")
    .select("id", { count: "exact", head: true });
  if (!error) {
    $("idea-count").textContent = count ?? ideas.length;
    $("history-count").textContent = count ?? ideas.length;
  }
  render();
}
function render() {
  $("history").replaceChildren();
  if (!ideas.length) {
    const empty = el("div", null, "empty");
    empty.append(
      el("span", null, "empty-mark"),
      el("h3", "Toda criação começa com uma ideia."),
      el("p", "Escreva ou grave a primeira. O resto a gente organiza."),
    );
    $("history").append(empty);
    return;
  }
  const states = {
    pending: "A organizar",
    transcribing: "Transcrevendo",
    generating: "Gerando",
    ready: "Organizada",
    error: "Precisa de atenção",
    deleting: "Exclusão pendente",
  };
  for (const idea of ideas) {
    const card = el("article", null, "idea");
    card.dataset.id = idea.id;
    const meta = el("div", null, "idea-meta");
    meta.append(
      el(
        "span",
        idea.source === "audio" ? "IDEIA EM ÁUDIO" : "IDEIA EM TEXTO",
      ),
      el("span", "·"),
      el(
        "time",
        new Date(idea.created_at).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
      ),
      el("span", states[idea.status] || idea.status, "state"),
    );
    const body = el("div", null, "idea-body");
    body.append(
      el(
        "p",
        idea.original_text || "Áudio salvo. Aguardando transcrição.",
        "idea-text",
      ),
    );
    if (idea.audio_path)
      body.append(
        button("Ouvir áudio original", async () => {
          const data = check(
            await client.storage
              .from("audios")
              .createSignedUrl(idea.audio_path, 600),
          );
          let audio = body.querySelector("audio");
          if (!audio) {
            audio = el("audio");
            audio.controls = true;
            body.prepend(audio);
          }
          audio.src = data.signedUrl;
          await audio.play().catch(() => {});
          notice(
            "Áudio disponível por 10 minutos. Para renovar o acesso, clique em Ouvir novamente.",
          );
        }),
      );
    for (const [key, label] of [
      ["summary", "Resumo"],
      ["prompt", "Prompt de implementação"],
    ]) {
      if (!idea[key]) continue;
      const section = el("section", null, "result");
      section.append(
        el("h3", label),
        el("pre", idea[key]),
        button(
          `Copiar ${key === "summary" ? "resumo" : "prompt"}`,
          async () => {
            try {
              await navigator.clipboard.writeText(idea[key]);
              notice(`${label} copiado.`);
            } catch {
              notice(
                "Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.",
                true,
              );
            }
          },
        ),
      );
      body.append(section);
    }
    if (idea.error_message) body.append(el("p", idea.error_message, "error"));
    const actions = el("div", null, "actions");
    if (aiEnabled)
      actions.append(
        button(
          idea.prompt ? "Gerar prompt novamente" : "Gerar prompt",
          () => processIdea(idea.id, true),
          "secondary",
        ),
      );
    if (aiEnabled && idea.status !== "ready")
      actions.append(
        button("Tentar novamente", () =>
          processIdea(idea.id, idea.generate_prompt),
        ),
      );
    if (idea.original_text)
      actions.append(
        button("Corrigir texto", async () => {
          if (body.querySelector(".edit-text")) return;
          const area = el("textarea", idea.original_text, "edit-text");
          area.value = idea.original_text;
          area.maxLength = 20000;
          area.setAttribute("aria-label", "Texto corrigido");
          const editActions = el("div", null, "actions");
          editActions.append(
            button("Salvar correção", () => saveCorrection(false)),
          );
          if (aiEnabled)
            editActions.append(
              button("Salvar e gerar resumo + prompt", () =>
                saveCorrection(true),
              ),
            );
          editActions.append(
            button("Cancelar", async () => {
              area.remove();
              editActions.remove();
            }),
          );
          body.append(area, editActions);
          area.focus();
          async function saveCorrection(generate) {
            if (!area.value.trim())
              throw new Error("O texto não pode ficar vazio.");
            if (aiEnabled)
              await invoke({
                action: "edit",
                id: idea.id,
                text: area.value.trim(),
              });
            else
              check(
                await client
                  .from("cad_ideias")
                  .update({
                    original_text: area.value.trim(),
                    summary: null,
                    prompt: null,
                    status: "pending",
                    error_message: null,
                  })
                  .eq("id", idea.id),
              );
            await refresh();
            if (generate && aiEnabled) await processIdea(idea.id, true);
            else
              notice(
                "Correção salva. O resumo e o prompt anteriores foram removidos; gere novamente quando quiser.",
              );
          }
        }),
      );
    actions.append(
      button(
        "Excluir",
        async () => {
          deleteId = idea.id;
          $("delete-dialog").showModal();
        },
        "text-button delete-button",
      ),
    );
    body.append(actions);
    card.append(meta, body);
    $("history").append(card);
    if (busy)
      card
        .querySelectorAll("button")
        .forEach((button) => (button.disabled = true));
  }
}
async function processIdea(id, generatePrompt) {
  const idea = ideas.find((i) => i.id === id);
  notice(
    idea?.source === "audio" && !idea.original_text
      ? "Transcrevendo o áudio… Em seguida, a IA vai organizar sua ideia."
      : "Gerando resumo" + (generatePrompt ? " e prompt…" : "…"),
  );
  // Polling somente durante esta chamada, para mostrar as etapas persistidas.
  let polling = true;
  const poll = setInterval(async () => {
    const { data } = await client
      .from("cad_ideias")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (polling && data?.status === "generating")
      notice("Gerando resumo" + (generatePrompt ? " e prompt…" : "…"));
  }, 3500);
  try {
    await invoke({ action: "process", id, generatePrompt });
    await refresh();
    notice("Ideia organizada e salva.");
  } catch (e) {
    await refresh().catch(() => {});
    throw e;
  } finally {
    polling = false;
    clearInterval(poll);
  }
}
function clearAudio() {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blob = null;
  blobUrl = null;
  $("draft-audio").removeAttribute("src");
  $("audio-preview").hidden = true;
  $("idea-text").disabled = false;
  $("record").hidden = false;
  $("draft-kind").textContent = "NOVA IDEIA";
}
function stopRecording(discard = false) {
  cancelled = discard;
  if (recorder?.state === "recording") recorder.stop();
  clearInterval(timer);
  stream?.getTracks().forEach((track) => track.stop());
}
async function startRecording() {
  if (draftId)
    throw new Error("Conclua o envio pendente antes de gravar outra ideia.");
  if ($("idea-text").value.trim())
    throw new Error(
      "Envie ou apague o texto antes de gravar uma ideia em áudio.",
    );
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    throw new Error(
      "Este navegador não suporta gravação. Use um navegador atualizado em HTTPS ou localhost.",
    );
  const type = recordingFormat(MediaRecorder);
  if (!type)
    throw new Error(
      "Não há formato de áudio compatível neste navegador. Tente Chrome, Firefox ou Safari atualizado.",
    );
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: type,
      audioBitsPerSecond: 64000,
    });
    const chunks = [];
    cancelled = false;
    clearAudio();
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onerror = () => {
      stopRecording(true);
      notice("A gravação foi interrompida. Tente gravar novamente.", true);
    };
    recorder.onstop = () => {
      clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
      $("recording-panel").hidden = true;
      $("record").hidden = false;
      $("send").disabled = false;
      $("idea-text").disabled = false;
      if (!cancelled) {
        blob = new Blob(chunks, { type: recorder.mimeType });
        if (!blob.size || blob.size > MAX_BYTES || !extension(blob.type)) {
          clearAudio();
          notice(
            "Áudio vazio, muito grande ou incompatível. Grave novamente.",
            true,
          );
          return;
        }
        blobUrl = URL.createObjectURL(blob);
        $("draft-audio").src = blobUrl;
        $("audio-preview").hidden = false;
        $("record").hidden = true;
        $("idea-text").disabled = true;
        $("draft-kind").textContent = "IDEIA EM ÁUDIO";
      }
    };
    recorder.start(1000);
    started = performance.now();
    $("recording-time").textContent = "00:00";
    $("recording-panel").hidden = false;
    $("record").hidden = true;
    $("send").disabled = true;
    $("idea-text").disabled = true;
    timer = setInterval(() => {
      const elapsed = (performance.now() - started) / 1000;
      $("recording-time").textContent = clock(elapsed);
      if (elapsed >= maxSeconds) stopRecording();
    }, 200);
  } catch (e) {
    stream.getTracks().forEach((track) => track.stop());
    throw e;
  }
}
$("record").onclick = async () => {
  if (busy) return;
  lock(true);
  try {
    await startRecording();
  } catch (e) {
    notice(friendlyError(e), true);
  } finally {
    lock(false);
  }
};
$("stop-recording").onclick = () => stopRecording();
$("cancel-recording").onclick = () => stopRecording(true);
$("discard-audio").onclick = () => {
  if (draftId) {
    notice("Conclua o envio pendente para preservar seu áudio.", true);
    return;
  }
  clearAudio();
};
$("rerecord").onclick = $("record").onclick;
$("send").onclick = () =>
  run(async () => {
    if (recorder?.state === "recording") return;
    const text = $("idea-text").value.trim();
    if (!text && !blob)
      throw new Error("Escreva uma ideia ou grave um áudio primeiro.");
    draftId ||= crypto.randomUUID();
    if (blob) {
      uploadedPath ||= `${user.id}/${draftId}.${extension(blob.type)}`;
      notice("Enviando áudio… Mantenha esta página aberta.");
      check(
        await client.storage.from("audios").upload(uploadedPath, blob, {
          contentType: blob.type.split(";")[0],
          upsert: true,
        }),
      );
    }
    notice("Salvando ideia…");
    const row = {
      id: draftId,
      user_id: user.id,
      source: blob ? "audio" : "text",
      audio_path: uploadedPath || null,
      original_text: blob ? null : text,
      generate_prompt: $("generate-prompt").checked,
    };
    // Mesmo UUID em toda tentativa: uma resposta perdida nunca cria duas ideias.
    check(
      await client
        .from("cad_ideias")
        .upsert(row, { onConflict: "id", ignoreDuplicates: true }),
    );
    const id = draftId,
      generate = row.generate_prompt;
    draftId = null;
    uploadedPath = null;
    $("idea-text").value = "";
    clearAudio();
    await refresh();
    if (aiEnabled) await processIdea(id, generate);
    else
      notice(
        "Ideia salva. O processamento por IA está desativado nesta publicação.",
      );
  });
$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  const submit = e.submitter;
  submit.disabled = true;
  try {
    const { error } = await client.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value,
    });
    if (error)
      throw new Error(
        error.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : "Não foi possível entrar. Confira sua conexão e a configuração do Supabase.",
      );
    $("password").value = "";
    notice("");
  } catch (error) {
    notice(friendlyError(error), true);
  } finally {
    submit.disabled = false;
  }
};
$("logout").onclick = () =>
  run(async () => {
    check(await client.auth.signOut());
  });
$("load-more").onclick = () => run(() => refresh(true));
$("new-idea").onclick = () => {
  if (!user) return;
  $("idea-text").scrollIntoView({ behavior: "smooth", block: "center" });
  $("idea-text").focus();
};
$("cancel-delete").onclick = () => $("delete-dialog").close();
$("confirm-delete").onclick = () => {
  $("delete-dialog").close();
  run(async () => {
    try {
      if (aiEnabled) await invoke({ action: "delete", id: deleteId });
      else {
        const idea = ideas.find((item) => item.id === deleteId);
        if (idea?.audio_path)
          check(await client.storage.from("audios").remove([idea.audio_path]));
        check(await client.from("cad_ideias").delete().eq("id", deleteId));
      }
      notice("Ideia excluída.");
    } finally {
      await refresh();
    }
  });
};
window.addEventListener("beforeunload", (e) => {
  if (
    blob ||
    draftId ||
    recorder?.state === "recording" ||
    $("idea-text").value.trim()
  ) {
    e.preventDefault();
    e.returnValue = "";
  }
});
$("recording-limit").textContent =
  `Áudio de até ${clock(maxSeconds)} · máximo 25 MB`;
if (!aiEnabled) {
  $("generate-prompt").checked = false;
  $("generate-prompt").disabled = true;
  $("generate-prompt").closest("label").title =
    "O processamento por IA será configurado em uma próxima etapa.";
}
async function sessionChanged(session) {
  const previous = user?.id;
  user = session?.user;
  if (previous === user?.id) return;
  authVersion++;
  $("login-panel").hidden = !!user;
  $("workspace").hidden = !user;
  $("logout").hidden = !user;
  $("account-email").textContent = user?.email || "Acesso privado";
  if (user) {
    try {
      await Promise.all([refresh(), finance.setUser(user), tasks.setUser(user)]);
    } catch (e) {
      notice(friendlyError(e), true);
    }
  } else {
    stopRecording(true);
    clearAudio();
    ideas = [];
    $("history").replaceChildren();
    $("idea-text").value = "";
    draftId = null;
    uploadedPath = null;
    $("idea-count").textContent = "0";
    await finance.setUser(null);
    await tasks.setUser(null);
  }
}
if (!configured) $("setup").hidden = false;
else {
  $("login-panel").hidden = false;
  client.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => sessionChanged(session), 0);
  });
  const { data, error } = await client.auth.getSession();
  if (error)
    notice("Não foi possível recuperar sua sessão. Entre novamente.", true);
  else await sessionChanged(data.session);
}

document.addEventListener("keydown", (e) => {
  if (
    e.key.toLowerCase() === "n" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName) &&
    !$("delete-dialog").open
  ) {
    e.preventDefault();
    ({
      ideas: $("new-idea"),
      finance: $("new-finance"),
      tasks: $("new-task"),
    })[activeView].click();
  }
});

document.querySelectorAll(".module-link").forEach((item) => {
  item.onclick = () => run(() => switchView(item.dataset.view));
});
