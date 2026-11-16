import type { Metadata } from "next";
import { adminConfigured, isAdmin } from "@/lib/admin";
import { CLINIC_NAME } from "@/lib/clinic";
import AdminLogin from "@/components/admin/AdminLogin";
import AdminDashboard, { type StatusItem } from "@/components/admin/AdminDashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Odonto", robots: { index: false } };

export default async function AdminPage() {
  if (!(await isAdmin())) return <AdminLogin configured={adminConfigured()} />;

  const has = (k: string) => !!process.env[k];
  const status: StatusItem[] = [
    { group: "Geral", label: "Nome da clínica", ok: !!CLINIC_NAME, detail: CLINIC_NAME || "NEXT_PUBLIC_CLINIC_NAME não definido" },
    { group: "Geral", label: "Código de acesso do app", ok: has("ACCESS_CODE"), detail: has("ACCESS_CODE") ? "Definido (admin não precisa digitar)" : "Sem código: qualquer pessoa com o link gera imagens" },
    { group: "Simulação de sorriso", label: "IA de imagem · OpenAI", ok: has("OPENAI_API_KEY"), detail: has("OPENAI_API_KEY") ? "Configurada" : "OPENAI_API_KEY ausente" },
    { group: "Simulação de sorriso", label: "IA de imagem · Google (reserva)", ok: has("GEMINI_API_KEY"), detail: has("GEMINI_API_KEY") ? "Configurada" : "Opcional" , optional: true },
    { group: "Atendimento WhatsApp", label: "Claude (IA que responde)", ok: has("ANTHROPIC_API_KEY"), detail: has("ANTHROPIC_API_KEY") ? `Modelo: ${process.env.WHATSAPP_AI_MODEL || "claude-opus-5-5"}` : "ANTHROPIC_API_KEY ausente" },
    { group: "Atendimento WhatsApp", label: "Evolution API", ok: has("EVOLUTION_URL") && has("EVOLUTION_API_KEY") && has("EVOLUTION_INSTANCE"), detail: has("EVOLUTION_URL") ? (process.env.EVOLUTION_URL as string) : "EVOLUTION_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE ausentes" },
    { group: "Atendimento WhatsApp", label: "Segredo do webhook", ok: has("WHATSAPP_WEBHOOK_SECRET"), detail: has("WHATSAPP_WEBHOOK_SECRET") ? "Definido" : "WHATSAPP_WEBHOOK_SECRET ausente" },
    { group: "Atendimento WhatsApp", label: "Aviso para a recepção", ok: has("STAFF_WHATSAPP"), detail: has("STAFF_WHATSAPP") ? "Número definido" : "STAFF_WHATSAPP ausente: a equipe não recebe avisos", optional: true },
    { group: "Atendimento WhatsApp", label: "IA respondendo pacientes", ok: process.env.WHATSAPP_AI_ENABLED !== "false", detail: process.env.WHATSAPP_AI_ENABLED === "false" ? "Desligada (WHATSAPP_AI_ENABLED=false)" : "Ligada" },
  ];
  return <AdminDashboard status={status} hasEvolution={status[5].ok} hasClaude={status[4].ok} />;
}
