/**
 * Cliente mínimo da Evolution API v2 (testado contra o código da versão 2.3.7).
 *
 * Variáveis de ambiente:
 *  - EVOLUTION_URL       endereço público da sua Evolution (ex.: https://whats.suaclinica.com.br)
 *  - EVOLUTION_API_KEY   a AUTHENTICATION_API_KEY do .env da Evolution
 *  - EVOLUTION_INSTANCE  nome da instância (o número conectado)
 */

export type EvoKey = { id?: string; remoteJid?: string; fromMe?: boolean; remoteJidAlt?: string };

export type EvoMessage = {
  id?: string;
  key: EvoKey;
  pushName?: string | null;
  messageType?: string;
  message?: Record<string, unknown> | null;
  messageTimestamp?: number;
};

/**
 * Marcadores invisíveis no fim das mensagens enviadas pela IA. Servem para
 * diferenciar a IA de uma pessoa da equipe respondendo pelo mesmo número.
 */
export const BOT_MARK = "⁣";
export const HANDOFF_MARK = "⁣⁣";

function cfg() {
  const url = process.env.EVOLUTION_URL?.replace(/\/+$/, "");
  const apikey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE;
  if (!url || !apikey || !instance) throw new Error("Evolution não configurada (EVOLUTION_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE).");
  return { url, apikey, instance: encodeURIComponent(instance) };
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const { url, apikey } = cfg();
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Evolution ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Envia texto. `to` pode ser o número (5511999999999) ou o JID completo. */
export async function sendText(to: string, text: string, delayMs = 1200) {
  const { instance } = cfg();
  return call(`/message/sendText/${instance}`, { number: to, text, delay: delayMs });
}

/** Últimas mensagens da conversa, da mais nova para a mais antiga. */
export async function fetchHistory(remoteJid: string, limit = 30): Promise<EvoMessage[]> {
  const { instance } = cfg();
  const out = await call<{ messages?: { records?: EvoMessage[] } }>(`/chat/findMessages/${instance}`, {
    where: { key: { remoteJid } },
    offset: limit,
    page: 1,
  });
  return out.messages?.records ?? [];
}

/** Texto legível de uma mensagem do WhatsApp (ou uma descrição do anexo). */
export function textOf(m: EvoMessage): string {
  const msg = (m.message ?? {}) as Record<string, any>;
  const t =
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    msg.documentMessage?.caption ??
    msg.buttonsResponseMessage?.selectedDisplayText ??
    msg.listResponseMessage?.title;
  if (typeof t === "string" && t.trim()) {
    const kind = msg.imageMessage ? "[foto] " : msg.videoMessage ? "[vídeo] " : msg.documentMessage ? "[documento] " : "";
    return kind + t.trim();
  }
  if (msg.audioMessage) return "[o paciente enviou um áudio]";
  if (msg.imageMessage) return "[o paciente enviou uma foto]";
  if (msg.videoMessage) return "[o paciente enviou um vídeo]";
  if (msg.documentMessage) return "[o paciente enviou um documento]";
  if (msg.stickerMessage) return "[figurinha]";
  if (msg.locationMessage) return "[localização]";
  if (msg.contactMessage) return "[contato]";
  return "";
}

export const isBot = (m: EvoMessage) => !!m.key.fromMe && textOf(m).endsWith(BOT_MARK);
export const isHandoff = (m: EvoMessage) => !!m.key.fromMe && textOf(m).endsWith(HANDOFF_MARK);
