import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Gera as simulações de sorriso (ortodôntico / estético) com IA generativa.
 * Provedores: OpenAI (GPT Image) e Google Gemini — usa os que tiverem chave.
 *
 * Variáveis de ambiente:
 *  - OPENAI_API_KEY        chave da OpenAI (platform.openai.com → API keys)
 *  - OPENAI_IMAGE_MODELS   (opcional) modelos em ordem de preferência. Padrão: gpt-image-2,gpt-image-1
 *  - OPENAI_IMAGE_QUALITY  (opcional) low | medium | high (padrão)
 *  - GEMINI_API_KEY        chave do Google AI Studio
 *  - GEMINI_IMAGE_MODELS   (opcional) modelos em ordem de preferência
 *  - GEMINI_IMAGE_SIZE     (opcional) "1K", "2K" (padrão) ou "4K"
 *  - IMAGE_PROVIDERS       (opcional) ordem dos provedores. Padrão: openai,gemini
 *  - ACCESS_CODE           (opcional) se definido, o app precisa enviar este código
 */

const DEFAULT_MODELS = ["gemini-3-pro-image", "gemini-3.1-flash-image"];
const DEFAULT_OPENAI_MODELS = ["gpt-image-2", "gpt-image-1"];

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

type Input = { mimeType: string; data: string; prompt: string; quality: string };
type Generated = { b64: string; mime: string; model: string; info?: string };

const list = (v: string | undefined, def: string[]) =>
  (v || def.join(","))
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

/** Erros em que repetir não adianta (chave, permissão, cota, modelo inexistente). */
const FATAL = /\b(401|403|404|429)\b|not found|permission|API key|quota|billing|verif/i;

async function viaOpenAI(input: Input, errors: string[]): Promise<Generated | null> {
  const apiKey = process.env.OPENAI_API_KEY!;
  const bytes = Buffer.from(input.data, "base64");
  const ext = input.mimeType.split("/")[1];

  for (const model of list(process.env.OPENAI_IMAGE_MODELS, DEFAULT_OPENAI_MODELS)) {
    // parâmetros opcionais: se o modelo recusar algum, ele é retirado e tenta-se de novo
    const extras: Record<string, string> = {
      quality: input.quality,
      // o gpt-image-2 já preserva a foto original e recusa este parâmetro
      ...(model.startsWith("gpt-image-2") ? {} : { input_fidelity: "high" }),
      output_format: "jpeg",
    };
    for (let attempt = 0; attempt < 5; attempt++) {
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", input.prompt);
      form.set("size", "1024x1024");
      form.set("n", "1");
      for (const [k, v] of Object.entries(extras)) form.set(k, v);
      form.set("image", new Blob([bytes], { type: input.mimeType }), `sorriso.${ext}`);

      let status = 0;
      let text = "";
      try {
        const res = await fetch(`${(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")}/images/edits`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });
        status = res.status;
        text = await res.text();
        if (res.ok) {
          const item = (JSON.parse(text) as { data?: { b64_json?: string; url?: string }[] }).data?.[0];
          if (item?.b64_json)
            return { b64: item.b64_json, mime: extras.output_format ? "image/jpeg" : "image/png", model };
          if (item?.url) {
            const img = await fetch(item.url);
            if (img.ok)
              return {
                b64: Buffer.from(await img.arrayBuffer()).toString("base64"),
                mime: img.headers.get("content-type") || "image/png",
                model,
              };
          }
          errors.push(`${model}: resposta sem imagem`);
          continue;
        }
      } catch (e) {
        errors.push(`${model}: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
        continue;
      }

      let msg = text.slice(0, 300);
      let param: string | null = null;
      try {
        const err = (JSON.parse(text) as { error?: { message?: string; param?: string } }).error;
        if (err?.message) msg = err.message.slice(0, 300);
        param = err?.param ?? null;
      } catch {}
      errors.push(`${model}: ${status} ${msg}`);

      // parâmetro opcional não aceito por este modelo → remove e tenta de novo
      const bad = Object.keys(extras).find((k) => param === k || new RegExp(`\\b${k}\\b`).test(msg));
      if (status === 400 && bad) {
        delete extras[bad];
        continue;
      }
      if (status === 400 || FATAL.test(`${status} ${msg}`)) break;
    }
  }
  return null;
}

async function viaGemini(input: Input, errors: string[]): Promise<Generated | null> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const wanted = (process.env.GEMINI_IMAGE_SIZE || "2K").toUpperCase();

  for (const model of list(process.env.GEMINI_IMAGE_MODELS, DEFAULT_MODELS)) {
    // 1ª tentativa em alta resolução; se o modelo não aceitar o tamanho, cai para o padrão.
    let imageSize: string | undefined = wanted === "1K" ? undefined : wanted;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [
            { role: "user", parts: [{ inlineData: { mimeType: input.mimeType, data: input.data } }, { text: input.prompt }] },
          ],
          config: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: "1:1", ...(imageSize ? { imageSize } : {}) },
          },
        });
        const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        if (part?.inlineData?.data)
          return { b64: part.inlineData.data, mime: part.inlineData.mimeType || "image/png", model, info: imageSize ?? "1K" };
        const reason = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? "sem imagem";
        errors.push(`${model}: ${reason}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${model}${imageSize ? ` (${imageSize})` : ""}: ${msg.slice(0, 200)}`);
        if (imageSize && /\b400\b|INVALID_ARGUMENT|image_?size/i.test(msg) && !/API key/i.test(msg)) {
          imageSize = undefined;
          continue;
        }
        if (/\b400\b/.test(msg) || FATAL.test(msg)) break;
      }
    }
  }
  return null;
}

const PROVIDERS = {
  openai: { key: "OPENAI_API_KEY", run: viaOpenAI, name: "OpenAI" },
  gemini: { key: "GEMINI_API_KEY", run: viaGemini, name: "Google" },
} as const;

export async function POST(req: Request) {
  const providers = list(process.env.IMAGE_PROVIDERS, ["openai", "gemini"])
    .map((p) => p.toLowerCase())
    .filter((p): p is keyof typeof PROVIDERS => p in PROVIDERS && !!process.env[PROVIDERS[p as keyof typeof PROVIDERS].key]);
  if (!providers.length)
    return json(
      { error: "IA generativa não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY no servidor (Vercel → Settings → Environment Variables) e faça Redeploy." },
      503,
    );

  const access = process.env.ACCESS_CODE;
  if (access && req.headers.get("x-access-code") !== access)
    return json({ error: "Código de acesso inválido. Informe o código em “Ajustes da IA”." }, 401);

  let body: { image?: string; shade?: string; style?: string; mode?: string; quality?: string };
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

  const quality = ["low", "medium", "high"].includes(body.quality ?? "")
    ? body.quality!
    : (process.env.OPENAI_IMAGE_QUALITY || "high").toLowerCase();
  const input: Input = { mimeType, data, prompt: buildPrompt(mode, shade, style), quality };
  const errors: string[] = [];
  const started = Date.now();

  for (const p of providers) {
    const mark = errors.length;
    const out = await PROVIDERS[p].run(input, errors);
    for (let i = mark; i < errors.length; i++) errors[i] = `[${p}] ${errors[i]}`;
    if (out) {
      console.log(`[lente] ok provedor=${p} modelo=${out.model} modo=${mode} ${Date.now() - started}ms`, errors);
      return json({ image: await toJpeg(out.b64, out.mime), provider: p, model: out.model, mode, shade, style });
    }
  }

  console.error("[lente] falha na geração", errors);
  const last = providers[providers.length - 1];
  const who = providers.map((p) => PROVIDERS[p].name).join(" / ");
  const mine = errors.filter((e) => e.startsWith(`[${last}]`));
  const quota = mine.length > 0 && mine.every((e) => /429|quota|RESOURCE_EXHAUSTED|billing/i.test(e));
  const verify = errors.some((e) => /must be verified|verif/i.test(e));
  const keyProblem = errors.some((e) => /API key|\b401\b|\b403\b|permission/i.test(e));
  return json(
    {
      error: verify
        ? "A OpenAI exige verificar a organização para usar o modelo de imagem: platform.openai.com → Settings → Organization → Verify. Depois aguarde alguns minutos."
        : quota
          ? `Sem cota/crédito de IA em ${who}. Confira o saldo e o faturamento da chave.`
          : keyProblem
            ? `A chave de IA foi recusada (${who}). Confira a chave e as permissões.`
            : "A IA não conseguiu gerar a simulação para esta foto. Tente outra foto, com o sorriso mais aberto e boa luz.",
      details: errors,
    },
    502,
  );
}
