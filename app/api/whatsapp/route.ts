import { after } from "next/server";
import { handleIncoming, type WebhookBody } from "@/lib/whatsapp/attendant";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Webhook da Evolution API (evento MESSAGES_UPSERT).
 * Segurança: a Evolution envia o cabeçalho x-webhook-secret configurado no webhook,
 * que precisa ser igual a WHATSAPP_WEBHOOK_SECRET.
 */
export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return Response.json({ error: "não autorizado" }, { status: 401 });
  }
  if (process.env.WHATSAPP_AI_ENABLED === "false") return Response.json({ ok: true, ai: "desligada" });

  let body: WebhookBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "json inválido" }, { status: 400 });
  }

  // Responde na hora (a Evolution reenvia se demorar) e processa em seguida.
  after(async () => {
    try {
      const result = await handleIncoming(body);
      if (!result.startsWith("ignorado")) console.log(`[atendimento] ${body.data?.key?.remoteJid}: ${result}`);
    } catch (e) {
      console.error("[atendimento] erro", e);
    }
  });
  return Response.json({ ok: true });
}

/** Verificação rápida da configuração (não mostra nenhum segredo). */
export async function GET() {
  const has = (k: string) => !!process.env[k];
  return Response.json({
    evolution: has("EVOLUTION_URL") && has("EVOLUTION_API_KEY") && has("EVOLUTION_INSTANCE"),
    claude: has("ANTHROPIC_API_KEY"),
    segredoWebhook: has("WHATSAPP_WEBHOOK_SECRET"),
    avisoEquipe: has("STAFF_WHATSAPP"),
    modelo: process.env.WHATSAPP_AI_MODEL || "claude-opus-5-5",
    iaLigada: process.env.WHATSAPP_AI_ENABLED !== "false",
  });
}
