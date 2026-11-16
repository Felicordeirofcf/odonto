import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Gera a simulação de lente de contato dental com IA generativa (Google Gemini).
 *
 * Variáveis de ambiente:
 *  - GEMINI_API_KEY      (obrigatória) chave do Google AI Studio
 *  - GEMINI_IMAGE_MODELS (opcional) modelos em ordem de preferência, separados por vírgula
 *  - GEMINI_IMAGE_SIZE   (opcional) "1K", "2K" (padrão) ou "4K"
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

const REALISM = [
  "REALISM (most important):",
  "- It must look like an unedited photograph of real teeth, never like a render, sticker or whitening filter.",
  "- Real enamel: subtle translucency at the incisal edges, slightly warmer tone near the gum line, fine surface texture, soft natural specular highlights consistent with the light direction in the photo.",
  "- Visible individual teeth with natural interproximal shadows and embrasures; never a single flat white strip. Back teeth fade naturally into the shadow of the cheeks.",
  "- Match the photo's sharpness, noise/grain, depth of field and white balance exactly.",
  "- Gums stay healthy pink with natural gingival margins around each tooth.",
  "",
  "DO NOT CHANGE anything else: lips (shape, color, texture, position), mouth opening, tongue, skin, pores, wrinkles, facial hair, nose, chin, background, lighting, framing. Do not zoom, crop, rotate, shift or re-frame — every pixel outside the teeth must stay aligned with the original.",
  "No text, watermark, border or split view. Output only the edited photograph.",
];

const INTRO =
  "You are a dental smile simulator used by a dentist to show a patient a realistic preview. The image is a real close-up photograph of the lower half of a patient's face, smiling.";

function buildPrompt(mode: string, shade: string, style: string) {
  if (mode === "ortho")
    return [
      INTRO,
      "",
      "TASK: simulate the result of ORTHODONTIC treatment (braces / clear aligners). Edit ONLY the visible teeth.",
      "Move the teeth into ideal alignment: straighten crooked and rotated teeth, resolve crowding and overlaps, close gaps (diastemas), level the incisal edges into a harmonious smile arc and center the midline.",
      "PRESERVE each tooth's own identity: the same shade and color (do NOT whiten — keep existing staining and yellowness exactly), the same size, natural shape, wear and surface texture, and the same number of teeth. Only their position and angulation change.",
      "",
      ...REALISM,
    ].join("\n");

  return [
    INTRO,
    "",
    "TASK: simulate a COSMETIC smile makeover with porcelain veneers (dental contact lenses) placed by an excellent cosmetic dentist. Edit ONLY the teeth.",
    STYLES[style],
    `Target shade: ${SHADES[shade]}.`,
    "Improve shape, color and position: correct crooked, rotated, chipped, worn, short or stained teeth, close gaps, and REPLACE any missing teeth with natural-looking ones. Keep the same dental arch, midline and smile width — improve the teeth, do not move the smile.",
    "White but not glowing: brightness must be plausible for the photo's exposure. No bloom, no blown-out pure white.",
    "",
    ...REALISM,
  ].join("\n");
}

/** PNG grande estoura o limite de resposta da Vercel: devolve JPEG de alta qualidade. */
async function toJpeg(b64: string, mime: string): Promise<string> {
  try {
    const buf = await sharp(Buffer.from(b64, "base64")).jpeg({ quality: 93, chromaSubsampling: "4:4:4" }).toBuffer();
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    return `data:${mime};base64,${b64}`;
  }
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

  let body: { image?: string; shade?: string; style?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Requisição inválida." }, 400);
  }

  const shade = body.shade && SHADES[body.shade] ? body.shade : "BL2";
  const style = body.style && STYLES[body.style] ? body.style : "natural";
  const mode = body.mode === "ortho" ? "ortho" : "cosmetic";
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.image ?? "");
  if (!match) return json({ error: "Imagem inválida." }, 400);
  const [, mimeType, data] = match;
  if (data.length * 0.75 > MAX_BYTES) return json({ error: "Imagem muito grande." }, 413);

  const models = (process.env.GEMINI_IMAGE_MODELS || DEFAULT_MODELS.join(","))
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildPrompt(mode, shade, style);
  const errors: string[] = [];
  const wanted = (process.env.GEMINI_IMAGE_SIZE || "2K").toUpperCase();

  for (const model of models) {
    // 1ª tentativa em alta resolução; se o modelo não aceitar o tamanho, cai para o padrão.
    let imageSize: string | undefined = wanted === "1K" ? undefined : wanted;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ inlineData: { mimeType, data } }, { text: prompt }] }],
          config: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: "1:1", ...(imageSize ? { imageSize } : {}) },
          },
        });
        const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        if (part?.inlineData?.data) {
          return json({
            image: await toJpeg(part.inlineData.data, part.inlineData.mimeType || "image/png"),
            model,
            mode,
            shade,
            style,
            size: imageSize ?? "1K",
          });
        }
        const reason = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? "sem imagem";
        errors.push(`${model}: ${reason}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${model}${imageSize ? ` (${imageSize})` : ""}: ${msg.slice(0, 200)}`);
        // tamanho não suportado por este modelo: tenta de novo no tamanho padrão
        if (imageSize && /\b400\b|INVALID_ARGUMENT|image_?size/i.test(msg) && !/API key/i.test(msg)) {
          imageSize = undefined;
          continue;
        }
        // modelo inexistente / sem permissão / chave inválida / cota: não adianta repetir
        if (/\b(400|401|403|404|429)\b|not found|permission|API key|quota/i.test(msg)) break;
      }
    }
  }

  console.error("[lente] falha na geração", errors);
  const keyProblem = errors.some((e) => /API key|401|403|permission/i.test(e));
  const quotaProblem = errors.length > 0 && errors.every((e) => /429|quota|RESOURCE_EXHAUSTED/i.test(e));
  return json(
    {
      error: quotaProblem
        ? "Cota da IA esgotada no Google. Ative o faturamento (plano pago) da chave em aistudio.google.com ou aguarde alguns minutos."
        : keyProblem
          ? "A chave GEMINI_API_KEY foi recusada pelo Google. Confira a chave e se o faturamento está ativo."
          : "A IA não conseguiu gerar a lente para esta foto. Tente outra foto, com o sorriso mais aberto e boa luz.",
      details: errors,
    },
    502,
  );
}
