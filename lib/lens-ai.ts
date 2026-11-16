import { exportImages, viewRect, type SimImages, type SimulationData } from "./analyze";

/**
 * Lente de contato com IA generativa.
 *
 * Só um recorte quadrado da parte de baixo do rosto é enviado ao servidor.
 * O resultado volta e passa por três etapas para ficar natural:
 *   1. alinhamento — corrige pequenos deslocamentos que a IA introduz;
 *   2. igualação de cor — ajusta o tom da imagem gerada ao da foto original;
 *   3. colagem só na região da boca, com borda suave.
 * O resto do rosto continua idêntico à foto original.
 */

const SEND_SIZE = 1536;
const ALIGN_SIZE = 192;

export type LensAIResult = SimImages;
export type LensStyle = "natural" | "hollywood";

export class LensAIError extends Error {}

/** Contorno da boca em coordenadas do recorte (0..size), expandido por `grow`. */
function mouthPath(ctx: CanvasRenderingContext2D, sim: SimulationData, size: number, grow: number) {
  const sq = viewRect(sim);
  const { poly, box } = sim;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const k = size / sq.w;
  ctx.beginPath();
  poly.forEach((p, i) => {
    const x = (cx + (p.x - cx) * grow - sq.x) * k;
    const y = (cy + (p.y - cy) * grow - sq.y) * k;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.closePath();
}

function canvas(w: number, h = w) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Máscara binária (Uint8) do contorno da boca expandido, no tamanho `size`. */
function maskBits(sim: SimulationData, size: number, grow: number): Uint8Array {
  const c = canvas(size);
  const ctx = c.getContext("2d")!;
  mouthPath(ctx, sim, size, grow);
  ctx.fill();
  const d = ctx.getImageData(0, 0, size, size).data;
  const out = new Uint8Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return out;
}

function small(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): Uint8ClampedArray {
  const c = canvas(ALIGN_SIZE);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, ALIGN_SIZE, ALIGN_SIZE);
  return ctx.getImageData(0, 0, ALIGN_SIZE, ALIGN_SIZE).data;
}

/**
 * Compara a foto original e a gerada FORA da boca (pele, lábios) para achar
 * o deslocamento e o ajuste de cor que fazem as duas coincidirem.
 */
function registration(sim: SimulationData, gen: HTMLImageElement) {
  const sq = viewRect(sim);
  const N = ALIGN_SIZE;
  const a = small(sim.source, sq.x, sq.y, sq.w, sq.h);
  const b = small(gen, 0, 0, gen.naturalWidth, gen.naturalHeight);
  const inner = maskBits(sim, N, 1.35);
  const outer = maskBits(sim, N, 2.4);
  const lum = (d: Uint8ClampedArray, i: number) => d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;

  const R = 6;
  let best = { dx: 0, dy: 0, err: Infinity };
  let zeroErr = Infinity;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      let err = 0;
      let n = 0;
      for (let y = R; y < N - R; y += 2)
        for (let x = R; x < N - R; x += 2) {
          const i = y * N + x;
          if (inner[i] || !outer[i]) continue;
          err += Math.abs(lum(a, i) - lum(b, (y + dy) * N + (x + dx)));
          n++;
        }
      if (!n) continue;
      err /= n;
      if (dx === 0 && dy === 0) zeroErr = err;
      if (err < best.err) best = { dx, dy, err };
    }
  // só desloca se melhorar de verdade (evita "tremer" por ruído)
  if (!(best.err < zeroErr * 0.9)) best = { dx: 0, dy: 0, err: zeroErr };

  // ganho de cor por canal, medido no anel em volta da boca
  const sum = { a: [0, 0, 0], b: [0, 0, 0] };
  for (let y = R; y < N - R; y++)
    for (let x = R; x < N - R; x++) {
      const i = y * N + x;
      if (inner[i] || !outer[i]) continue;
      const j = (y + best.dy) * N + (x + best.dx);
      for (let c = 0; c < 3; c++) {
        sum.a[c] += a[i * 4 + c];
        sum.b[c] += b[j * 4 + c];
      }
    }
  const gain = sum.a.map((v, c) => Math.min(1.2, Math.max(0.83, sum.b[c] > 0 ? v / sum.b[c] : 1)));

  // (dx,dy): a foto gerada está deslocada desse tanto em relação à original
  return { dx: (best.dx / N) * sq.w, dy: (best.dy / N) * sq.w, gain };
}

export type AIMode = "ortho" | "cosmetic";

export async function generateLensAI(
  sim: SimulationData,
  opts: { mode: AIMode; shade: string; style: LensStyle },
  accessCode: string,
): Promise<LensAIResult> {
  const sq = viewRect(sim);
  const send = canvas(SEND_SIZE);
  const sctx = send.getContext("2d")!;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(sim.source, sq.x, sq.y, sq.w, sq.h, 0, 0, SEND_SIZE, SEND_SIZE);
  const image = send.toDataURL("image/jpeg", 0.93);

  let res: Response;
  try {
    res = await fetch("/api/lente", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessCode ? { "x-access-code": accessCode } : {}) },
      body: JSON.stringify({ image, ...opts }),
    });
  } catch {
    throw new LensAIError("Sem conexão com o servidor. Verifique a internet.");
  }
  const data = (await res.json().catch(() => ({}))) as { image?: string; error?: string };
  if (!res.ok || !data.image) throw new LensAIError(data.error || "A IA não conseguiu gerar a imagem. Tente de novo.");

  const gen = await loadImage(data.image);
  const { dx, dy, gain } = registration(sim, gen);

  // Imagem gerada, alinhada e com a cor igualada, no tamanho do recorte original
  const S = sq.w;
  const layer = canvas(S);
  const l = layer.getContext("2d", { willReadFrequently: true })!;
  l.imageSmoothingQuality = "high";
  l.drawImage(gen, -dx, -dy, S, S);
  if (gain.some((g) => Math.abs(g - 1) > 0.01)) {
    const img = l.getImageData(0, 0, S, S);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.min(255, d[i] * gain[0]);
      d[i + 1] = Math.min(255, d[i + 1] * gain[1]);
      d[i + 2] = Math.min(255, d[i + 2] * gain[2]);
    }
    l.putImageData(img, 0, 0);
  }

  // Máscara suave da boca: desenhada pequena e ampliada (desfoque que funciona em qualquer navegador)
  const feather = Math.max(3, sim.box.w * 0.05);
  const k = Math.max(1, feather / 1.5);
  const tiny = canvas(Math.ceil(S / k));
  const t = tiny.getContext("2d")!;
  t.fillStyle = "#fff";
  mouthPath(t, sim, tiny.width, 1.16);
  t.fill();
  l.globalCompositeOperation = "destination-in";
  l.drawImage(tiny, 0, 0, S, S);

  const out = canvas(sim.source.width, sim.source.height);
  const o = out.getContext("2d")!;
  o.drawImage(sim.source, 0, 0);
  o.drawImage(layer, sq.x, sq.y);

  return exportImages(out, sim);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new LensAIError("Imagem gerada inválida."));
    img.src = src;
  });
}
