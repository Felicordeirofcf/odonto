import { adminConfigured, checkPassword, clearAdminCookie, setAdminCookie } from "@/lib/admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!adminConfigured())
    return Response.json({ error: "Defina ADMIN_PASSWORD na Vercel e faça Redeploy." }, { status: 503 });
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  // pequena espera contra tentativas em série
  await new Promise((r) => setTimeout(r, 400));
  if (!password || !checkPassword(password)) return Response.json({ error: "Senha incorreta." }, { status: 401 });
  await setAdminCookie();
  return Response.json({ ok: true });
}

export async function DELETE() {
  await clearAdminCookie();
  return Response.json({ ok: true });
}
