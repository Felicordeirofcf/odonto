import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Acesso de administrador simples, para o piloto.
 * A senha fica na variável ADMIN_PASSWORD da Vercel; o cookie guarda só uma
 * assinatura derivada dela (trocar a senha desconecta todo mundo).
 */
export const ADMIN_COOKIE = "odonto_admin";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 dias

function token(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return createHmac("sha256", pw).update("odonto-admin-v1").digest("hex");
}

function safeEq(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function adminConfigured() {
  return !!process.env.ADMIN_PASSWORD;
}

export function checkPassword(pw: string) {
  const real = process.env.ADMIN_PASSWORD;
  return !!real && safeEq(pw, real);
}

export async function isAdmin(): Promise<boolean> {
  const t = token();
  if (!t) return false;
  const c = (await cookies()).get(ADMIN_COOKIE)?.value;
  return !!c && safeEq(c, t);
}

export async function setAdminCookie() {
  const t = token();
  if (!t) return;
  (await cookies()).set(ADMIN_COOKIE, t, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearAdminCookie() {
  (await cookies()).delete(ADMIN_COOKIE);
}
