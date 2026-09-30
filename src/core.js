export const FORMATS = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm",
];
export function recordingFormat(Recorder) {
  return FORMATS.find((type) => Recorder.isTypeSupported(type));
}
export function extension(type) {
  return { "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg" }[
    type.split(";")[0]
  ];
}
export function clock(seconds) {
  return (
    `${Math.floor(seconds / 60)}`.padStart(2, "0") +
    ":" +
    `${Math.floor(seconds % 60)}`.padStart(2, "0")
  );
}
export function friendlyError(error) {
  if (error?.name === "NotAllowedError")
    return "O acesso ao microfone foi negado. Permita o microfone nas configurações do navegador.";
  if (error?.name === "NotFoundError")
    return "Nenhum microfone foi encontrado. Conecte um microfone e tente novamente.";
  if (error?.name === "NotReadableError")
    return "O microfone está indisponível ou em uso por outro aplicativo.";
  if (/fetch|network|Failed to send/i.test(error?.message || ""))
    return "Falha de conexão. Confira sua internet e tente novamente. As ideias já salvas estão preservadas.";
  return error?.message || "Não foi possível concluir. Tente novamente.";
}
