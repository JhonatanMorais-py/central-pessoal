import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clock,
  extension,
  recordingFormat,
  friendlyError,
} from "../src/core.js";
import {
  validateAudio,
  validateGeneration,
  transcriptionText,
  systemPrompt,
} from "../supabase/functions/_shared/validation.js";
test("negocia formato suportado e não inventa conversão", () => {
  assert.equal(
    recordingFormat({ isTypeSupported: (t) => t === "audio/mp4" }),
    "audio/mp4",
  );
  assert.equal(recordingFormat({ isTypeSupported: () => false }), undefined);
  assert.equal(extension("audio/webm;codecs=opus"), "webm");
  assert.equal(extension("audio/aac"), undefined);
});
test("contador e erro de permissão legíveis", () => {
  assert.equal(clock(300), "05:00");
  assert.match(friendlyError({ name: "NotAllowedError" }), /negado/);
});
test("valida conteúdo real, tamanho e MIME, rejeitando arquivo renomeado", () => {
  const bytes = new Uint8Array([
    0, 0, 0, 20, 102, 116, 121, 112, 109, 112, 52, 50,
  ]);
  assert.equal(validateAudio(bytes, "audio/mp4", "x.mp4"), "mp4");
  assert.throws(() => validateAudio(bytes, "audio/webm", "x.webm"), /Formato/);
  assert.throws(() => validateAudio(bytes, "audio/mp4", "x.mp4", 4), /limite/);
  assert.throws(
    () => validateAudio(new Uint8Array(), "audio/mp4", "x.mp4"),
    /vazio/,
  );
});
test("sinaliza trechos de baixa confiança sem enviar conteúdo incerto para o resumo", () => {
  assert.equal(
    transcriptionText({
      segments: [
        { text: "Uma ideia", avg_logprob: -0.1 },
        { text: "inventado", avg_logprob: -2, start: 5 },
      ],
    }),
    "Uma ideia [trecho incompreensível ou incerto em 5s — revisar áudio]",
  );
});
test("resposta incompleta de IA não sobrescreve o resultado", () => {
  assert.throws(() =>
    validateGeneration({ summary: "ok", prompt: null }, true),
  );
  assert.deepEqual(
    validateGeneration({ summary: " Resumo ", prompt: "ignorado" }, false),
    { summary: "Resumo", prompt: null },
  );
  assert.match(systemPrompt(true), /dados não confiáveis/);
  assert.match(systemPrompt(true), /Não invente/);
});
