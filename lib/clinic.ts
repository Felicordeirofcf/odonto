/** Nome da clínica do piloto (variável NEXT_PUBLIC_CLINIC_NAME na Vercel). */
export const CLINIC_NAME = (process.env.NEXT_PUBLIC_CLINIC_NAME || "").trim();
export const APP_TITLE = CLINIC_NAME ? `${CLINIC_NAME} · Simulação de Sorriso` : "Odonto · Análise de Sorriso";
