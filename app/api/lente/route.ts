import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Gera a simulação de lente de contato dental com IA generativa (Google Gemini).
 *
 * Variáveis de ambiente:
 *  - GEMINI_API_KEY      (obrigatória) chave do Google AI Studio
 *  - GEMINI_IMAGE_MODELS (opcional) modelos em ordem de preferência, separados por vírgula
 *  - ACCESS_CODE         (opcional) se definido, o app precisa enviar este código
 */

const DEFAULT_MODELS = ["gemini-3-pro-image", "gemini-3.1-flash-image"];

const SHADES: Record<string, string> = {
  BL1: "VITA BL1 — the brightest bleached white, almost pure white with a hint of translucency",
  BL2: "VITA BL2 — very bright white",
  BL3: "VITA BL3 — bright white, slightly softer than BL2",
  BL4: "VITA BL4 — light, clean white with a natural warmth",
  B1: "VITA B1 — the lightest natural tooth shade, clean natural white",
};

const STYLES: Record<string, string> = {
  natural:
    "Natural-looking veneers: keep a natural tooth anatomy with slightly varied incisal edges, subtle surface texture, soft translucency at the edges and natural proportions — it must look like real, healthy teeth, not fake.",
  hollywood:
    "'Hollywood smile' veneers: perfectly straight, symmetric and uniform teeth, even incisal line following the lower lip, smooth glossy enamel, slightly fuller width — a striking, polished cosmetic result.",
};

const MAX_BYTES = 6 * 1024 * 1024;

function buildPrompt(shade: string, style: string) {
  return [
    "This is a close-up photo of a person's smile. Act as a cosmetic dentistry smile-design simulator.",
    "Edit ONLY the visible teeth: replace them with porcelain dental veneers (dental contact lenses).",
    STYLES[style],
    `Tooth shade: ${SHADES[shade]}.`,
    "Fix crooked, chipped, worn or stained teeth and close small gaps. Keep the same number of visible teeth and the same position of the dental arch.",
    "Keep EVERYTHING ELSE exactly identical: lips, lip shape, mouth opening, gums (just healthy pink), tongue, skin, facial hair, lighting, shadows, camera angle, framing, crop and resolution.",
    "The result must be photorealistic, matching the photo's lighting, grain and focus. Do not add text, watermarks or borders. Return only the edited image.",
  ].join("\n");
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey)
    return json({ error: "IA generativa não configurada: defina GEMINI_API_KEY no servidor (Vercel → Settings → Environment Variables)." }, 503);

  const access = process.env.ACCESS_CODE;
  if (access && req.headers.get("x-access-code") !== access)
    return json({ error: "Código de acesso inválido. Informe o código em “Ajustes da IA”." }, 401);

  let body: { image?: string; shade?: string; style?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Requisição inválida." }, 400);
  }

  const shade = body.shade && SHADES[body.shade] ? body.shade : "BL2";
  const style = body.style && STYLES[body.style] ? body.style : "natural";
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.image ?? "");
  if (!match) return json({ error: "Imagem inválida." }, 400);
  const [, mimeType, data] = match;
  if (data.length * 0.75 > MAX_BYTES) return json({ error: "Imagem muito grande." }, 413);

  const models = (process.env.GEMINI_IMAGE_MODELS || DEFAULT_MODELS.join(","))
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildPrompt(shade, style);
  const errors: string[] = [];

  for (const model of models) {
    // até 2 tentativas por modelo (falhas transitórias / resposta sem imagem)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data } }] }],
          config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } },
        });
        const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        if (part?.inlineData?.data) {
          return json({
            image: `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`,
            model,
            shade,
            style,
          });
        }
        const reason = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? "sem imagem";
        errors.push(`${model}: ${reason}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${model}: ${msg.slice(0, 200)}`);
        // modelo inexistente / sem permissão / chave inválida: não adianta repetir
        if (/\b(400|401|403|404)\b|not found|permission|API key/i.test(msg)) break;
      }
    }
  }

  console.error("[lente] falha na geração", errors);
  const keyProblem = errors.some((e) => /API key|401|403|permission/i.test(e));
  return json(
    {
      error: keyProblem
        ? "A chave GEMINI_API_KEY foi recusada pelo Google. Confira a chave e se o faturamento está ativo."
        : "A IA não conseguiu gerar a lente para esta foto. Tente outra foto, com o sorriso mais aberto e boa luz.",
      details: errors,
    },
    502,
  );
}
