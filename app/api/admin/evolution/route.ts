import { isAdmin } from "@/lib/admin";
import { connectionState } from "@/lib/whatsapp/evolution";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: "Faça login como admin." }, { status: 401 });
  try {
    const state = await connectionState();
    return Response.json({ state });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "falha" }, { status: 502 });
  }
}
