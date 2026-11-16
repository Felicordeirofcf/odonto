import { readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import {
  BOT_MARK,
  HANDOFF_MARK,
  fetchHistory,
  isBot,
  isHandoff,
  sendText,
  textOf,
  type EvoMessage,
} from "./evolution";

/**
 * IA de atendimento no WhatsApp (piloto, sem banco de dados).
 *
 * Variáveis de ambiente:
 *  - ANTHROPIC_API_KEY      chave da API do Claude
 *  - WHATSAPP_AI_MODEL      (opcional) padrão claude-opus-5-5; claude-haiku-5-5 custa bem menos
 *  - WHATSAPP_AI_EFFORT     (opcional) low (padrão) | medium | high
 *  - STAFF_WHATSAPP         (opcional) número da recepção que recebe os avisos (ex.: 5511999999999)
 *  - AI_PAUSE_HOURS         (opcional) horas que a IA fica em silêncio depois que a equipe assume (padrão 12)
 *  - CLINIC_INFO            (opcional) substitui o arquivo config/atendimento.md
 */

const DEBOUNCE_MS = 6_000; // espera o paciente terminar de digitar várias mensagens seguidas
const HISTORY_HOURS = 48;

export type WebhookBody = {
  event?: string;
  instance?: string;
  data?: EvoMessage;
};

export type Decision = {
  resposta: string;
  encaminhar_para_equipe: boolean;
  motivo: string;
  resumo_para_equipe: string;
};

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    resposta: { type: "string", description: "Mensagem a enviar ao paciente no WhatsApp." },
    encaminhar_para_equipe: {
      type: "boolean",
      description: "true quando a equipe humana precisa assumir esta conversa.",
    },
    motivo: { type: "string", description: "Por que encaminhar (vazio se não encaminhar)." },
    resumo_para_equipe: {
      type: "string",
      description: "Resumo curto para a recepção: nome, o que a pessoa quer, dias e horários preferidos.",
    },
  },
  required: ["resposta", "encaminhar_para_equipe", "motivo", "resumo_para_equipe"],
  additionalProperties: false,
} as const;

function clinicInfo(): string {
  if (process.env.CLINIC_INFO?.trim()) return process.env.CLINIC_INFO.trim();
  try {
    return readFileSync(path.join(process.cwd(), "config", "atendimento.md"), "utf8");
  } catch {
    return "(A clínica ainda não cadastrou as informações. Para qualquer dúvida, diga que a equipe vai responder.)";
  }
}

function systemPrompt(): string {
  return `Você é a assistente virtual de atendimento de uma clínica odontológica, conversando com pacientes pelo WhatsApp em português do Brasil.

Seu trabalho:
- Responder dúvidas usando SOMENTE as informações da clínica abaixo. Se a informação não estiver lá, diga que vai confirmar com a equipe — nunca invente preços, horários, nomes ou serviços.
- Levar a pessoa a agendar uma avaliação. A avaliação inclui a simulação do sorriso com IA (clareamento, aparelho ou lentes), que é um diferencial da clínica.
- Para agendar: pergunte o nome, o que a pessoa procura e os melhores dias e períodos. Quando tiver isso, diga que a recepção vai confirmar o horário em breve e encaminhe para a equipe.

Encaminhe para a equipe (encaminhar_para_equipe = true) quando:
- o agendamento estiver pronto para a recepção confirmar;
- houver dor, inchaço, sangramento, trauma ou qualquer urgência (nesse caso, peça para a pessoa vir/ligar o quanto antes, sem dar orientação clínica);
- a pessoa pedir desconto, negociar valores, reclamar, pedir reembolso ou falar de um tratamento em andamento;
- fizer pergunta clínica (diagnóstico, remédio, se um tratamento serve para ela);
- mandar áudio, foto ou documento que você não consegue ver;
- pedir para falar com uma pessoa.
Ao encaminhar, avise com gentileza que alguém da equipe vai continuar o atendimento.

Estilo:
- Mensagens curtas, como no WhatsApp: no máximo 3 frases, sem listas longas e sem markdown (nada de **, #, tabelas).
- Tom acolhedor e profissional. Trate pelo primeiro nome quando souber. No máximo um emoji, e só se combinar.
- Na primeira resposta da conversa, apresente-se como assistente virtual da clínica.
- Nunca prometa resultado de tratamento nem dê diagnóstico.

=== INFORMAÇÕES DA CLÍNICA ===
${clinicInfo()}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ts = (m: EvoMessage) => Number(m.messageTimestamp ?? 0);

function isPlainChat(jid?: string) {
  return !!jid && !jid.endsWith("@g.us") && !jid.endsWith("@broadcast") && !jid.endsWith("@newsletter") && jid !== "status@broadcast";
}

/** Processa uma mensagem recebida. Retorna o que foi feito (útil nos logs). */
export async function handleIncoming(body: WebhookBody): Promise<string> {
  if (body.event !== "messages.upsert") return "ignorado: evento " + body.event;
  const expected = process.env.EVOLUTION_INSTANCE;
  if (expected && body.instance && body.instance !== expected) return "ignorado: outra instância";
  const msg = body.data;
  const jid = msg?.key?.remoteJid;
  if (!msg || !jid || msg.key.fromMe || !isPlainChat(jid)) return "ignorado: não é mensagem de paciente";
  const staff = process.env.STAFF_WHATSAPP?.replace(/\D/g, "");
  if (staff && jid.startsWith(staff + "@")) return "ignorado: número da equipe";

  // 1) espera o paciente terminar de mandar mensagens seguidas
  await sleep(DEBOUNCE_MS);

  // 2) histórico atualizado (mais novo primeiro)
  const history = await fetchHistory(jid, 30);
  const newest = history[0];
  if (newest) {
    if (newest.key.fromMe) return "ignorado: já respondido";
    if (newest.key.id && msg.key.id && newest.key.id !== msg.key.id && ts(newest) >= ts(msg))
      return "ignorado: chegou mensagem mais nova (ela será respondida)";
  }

  // 3) a equipe assumiu? (mensagem do número da clínica sem o marcador da IA, ou encaminhamento recente)
  const pauseSec = Number(process.env.AI_PAUSE_HOURS || 12) * 3600;
  const now = Math.floor(Date.now() / 1000);
  const recent = history.filter((m) => now - ts(m) < pauseSec);
  if (recent.some((m) => m.key.fromMe && !isBot(m))) return "pausado: a equipe está respondendo";
  if (recent.some(isHandoff)) return "pausado: conversa encaminhada para a equipe";

  // 4) transcrição para a IA (ordem cronológica)
  const window = history
    .filter((m) => now - ts(m) < HISTORY_HOURS * 3600)
    .reverse();
  if (!window.some((m) => m.key.id === msg.key.id)) window.push(msg);
  const name = msg.pushName && msg.pushName !== "Você" ? msg.pushName : "";
  const messages = buildMessages(
    window.map((m) => ({ role: m.key.fromMe ? "assistant" : "user", text: textOf(m).replaceAll(BOT_MARK, "") })),
    name,
  );
  if (!messages) return "ignorado: nada novo para responder";

  // 5) decisão da IA
  const decision = (await decide(messages))?.decision ?? null;
  if (!decision) {
    await sendText(jid, "Recebi sua mensagem! Alguém da nossa equipe já vai te responder." + HANDOFF_MARK);
    await notifyStaff(jid, name, "A IA não conseguiu responder esta conversa.", "");
    return "falha da IA: encaminhado";
  }

  const reply = decision.resposta.trim();
  await sendText(jid, reply + (decision.encaminhar_para_equipe ? HANDOFF_MARK : BOT_MARK));
  if (decision.encaminhar_para_equipe) await notifyStaff(jid, name, decision.motivo, decision.resumo_para_equipe);
  return decision.encaminhar_para_equipe ? "respondido e encaminhado" : "respondido";
}

export type Turn = { role: "user" | "assistant"; text: string };

/** Monta a conversa para a IA. Retorna null se não há mensagem nova do paciente. */
export function buildMessages(turns: Turn[], name = ""): Anthropic.Beta.BetaMessageParam[] | null {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of turns) {
    const text = t.text.trim();
    if (!text) continue;
    if (!messages.length && t.role === "assistant") continue; // a conversa precisa começar pelo paciente
    messages.push({ role: t.role, content: text });
  }
  if (!messages.length || messages[messages.length - 1].role !== "user") return null;
  const nowBr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "full", timeStyle: "short" });
  messages.push({
    role: "user",
    content: `[contexto do sistema, não escrito pelo paciente: agora é ${nowBr}${name ? `; nome no WhatsApp: ${name}` : ""}]`,
  });
  return messages;
}

export type DecideResult = {
  decision: Decision;
  model: string;
  usage: { input: number; cached: number; output: number };
};

export async function decide(messages: Anthropic.Beta.BetaMessageParam[]): Promise<DecideResult | null> {
  const model = process.env.WHATSAPP_AI_MODEL || "claude-opus-5-5";
  const effort = (process.env.WHATSAPP_AI_EFFORT || "low") as "low" | "medium" | "high";
  const withFallback = /opus|sonnet|fable/.test(model);
  const client = new Anthropic();

  try {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 2000,
      system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
      messages,
      output_config: { effort, format: { type: "json_schema", schema: DECISION_SCHEMA } },
      ...(withFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });

    const u = res.usage;
    console.log(
      `[atendimento] modelo=${res.model} entrada=${u.input_tokens} cache=${u.cache_read_input_tokens ?? 0} saída=${u.output_tokens} parada=${res.stop_reason}`,
    );
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;

    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const parsed = JSON.parse(text) as Decision;
    if (!parsed.resposta?.trim()) return null;
    return {
      decision: parsed,
      model: res.model,
      usage: { input: u.input_tokens, cached: u.cache_read_input_tokens ?? 0, output: u.output_tokens },
    };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) console.error("[atendimento] ANTHROPIC_API_KEY inválida");
    else if (e instanceof Anthropic.RateLimitError) console.error("[atendimento] limite de uso da API do Claude");
    else if (e instanceof Anthropic.APIError) console.error(`[atendimento] erro da API do Claude ${e.status}: ${e.message}`);
    else console.error("[atendimento] falha", e);
    return null;
  }
}

async function notifyStaff(jid: string, name: string, motivo: string, resumo: string) {
  const staff = process.env.STAFF_WHATSAPP?.replace(/\D/g, "");
  if (!staff) return;
  const phone = jid.split("@")[0];
  const lines = [
    "🔔 Atendimento precisa da equipe",
    `Paciente: ${name || "sem nome"} · wa.me/${phone}`,
    motivo && `Motivo: ${motivo}`,
    resumo && `Resumo: ${resumo}`,
    "A IA parou de responder nesta conversa. Responda pelo WhatsApp da clínica.",
  ].filter(Boolean);
  try {
    await sendText(staff, lines.join("\n") + BOT_MARK, 0);
  } catch (e) {
    console.error("[atendimento] não consegui avisar a equipe", e);
  }
}
