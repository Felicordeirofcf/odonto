import { isAdmin } from "@/lib/admin";
import { buildMessages, decide, type Turn } from "@/lib/whatsapp/attendant";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Simulador da IA de atendimento: mesma IA do WhatsApp, sem enviar nada. */
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Faça login como admin." }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ error: "Defina ANTHROPIC_API_KEY na Vercel para testar a IA de atendimento." }, { status: 503 });

  const { turns, name } = (await req.json().catch(() => ({}))) as { turns?: Turn[]; name?: string };
  const clean = (turns ?? [])
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
    .slice(-40)
    .map((t) => ({ role: t.role, text: t.text.slice(0, 2000) }));
  const messages = buildMessages(clean, (name ?? "").slice(0, 60));
  if (!messages) return Response.json({ error: "Escreva uma mensagem como paciente." }, { status: 400 });

  const out = await decide(messages);
  if (!out) return Response.json({ error: "A IA não respondeu (veja os logs da Vercel)." }, { status: 502 });
  return Response.json(out);
}
