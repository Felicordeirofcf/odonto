import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { deltaE2000, labToRgb, rgbToLab, type Lab, type RGB } from "./color";
import { VITA_SHADES, type Shade } from "./shades";

/** Contorno interno dos lábios (índices do Face Mesh do MediaPipe). */
const INNER_MOUTH = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];

export type AnalysisSettings = {
  /** a* máximo (vermelho) para um pixel contar como dente — exclui gengiva/língua. */
  maxRedness: number;
  /** Croma máximo — exclui pixels muito saturados. */
  maxChroma: number;
  /** Percentil de luminosidade mínimo dentro da boca (0–100). */
  minLightnessPercentile: number;
  /** Peso da luminosidade no ΔE2000 (maior = ignora mais a exposição da foto). */
  lightnessWeight: number;
};

export const DEFAULT_SETTINGS: AnalysisSettings = {
  maxRedness: 12,
  maxChroma: 38,
  minLightnessPercentile: 35,
  lightnessWeight: 2,
};

export type ShadeMatch = { shade: Shade; deltaE: number; confidence: number };

export type AnalysisResult = {
  measured: Lab;
  matches: ShadeMatch[]; // as 3 mais próximas
  toothPixels: number;
  mouthPixels: number;
  /** Imagem (data URL) com os pixels de dente destacados. */
  overlay: string;
  /** Recorte da boca (data URL) para exibir/guardar. */
  crop: string;
  /** Dados para gerar simulações (clareamento, lentes). */
  sim: SimulationData;
};

export type SimulationData = {
  source: HTMLCanvasElement;
  box: { x: number; y: number; w: number; h: number };
  crop: { x: number; y: number; w: number; h: number };
  /** Peso 0–1 de cada pixel da caixa da boca (1 = dente). */
  weights: Float32Array;
  /** Lab original (sem calibração) de cada pixel da caixa. */
  labs: Float32Array;
  /** Cor mediana dos dentes na foto original (sem calibração). */
  raw: Lab;
  /** Contorno interno da boca, em pixels da foto. */
  poly: { x: number; y: number }[];
};

export class AnalysisError extends Error {}

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

export function loadLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      const opts = (delegate: "GPU" | "CPU") => ({
        baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate },
        runningMode: "IMAGE" as const,
        numFaces: 1,
      });
      try {
        return await FaceLandmarker.createFromOptions(fileset, opts("GPU"));
      } catch {
        return await FaceLandmarker.createFromOptions(fileset, opts("CPU"));
      }
    })();
    landmarkerPromise.catch(() => (landmarkerPromise = null));
  }
  return landmarkerPromise;
}

const percentile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)))] : 0;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return percentile(s, 50);
};

/**
 * Analisa a foto: localiza a boca, separa os pixels de dente e compara a cor
 * mediana com a escala VITA.
 *
 * @param whiteRef cor (RGB) de uma referência branca na foto, se o usuário calibrou.
 */
export async function analyzeSmile(
  source: HTMLCanvasElement,
  settings: AnalysisSettings = DEFAULT_SETTINGS,
  whiteRef: RGB | null = null,
): Promise<AnalysisResult> {
  const landmarker = await loadLandmarker();
  const detection = landmarker.detect(source);
  const face = detection.faceLandmarks[0];
  if (!face) throw new AnalysisError("Nenhum rosto encontrado. Enquadre o rosto inteiro, de frente e bem iluminado.");

  const W = source.width;
  const H = source.height;
  const poly = INNER_MOUTH.map((i) => ({ x: face[i].x * W, y: face[i].y * H }));

  const minX = Math.max(0, Math.floor(Math.min(...poly.map((p) => p.x))));
  const maxX = Math.min(W, Math.ceil(Math.max(...poly.map((p) => p.x))));
  const minY = Math.max(0, Math.floor(Math.min(...poly.map((p) => p.y))));
  const maxY = Math.min(H, Math.ceil(Math.max(...poly.map((p) => p.y))));
  const bw = maxX - minX;
  const bh = maxY - minY;
  if (bw < 10 || bh < 4) throw new AnalysisError("A boca parece fechada. Peça para o paciente sorrir mostrando os dentes.");

  // Máscara do polígono interno da boca
  const mask = document.createElement("canvas");
  mask.width = bw;
  mask.height = bh;
  const mctx = mask.getContext("2d")!;
  mctx.beginPath();
  poly.forEach((p, i) => (i ? mctx.lineTo(p.x - minX, p.y - minY) : mctx.moveTo(p.x - minX, p.y - minY)));
  mctx.closePath();
  mctx.fill();
  const maskData = mctx.getImageData(0, 0, bw, bh).data;

  const sctx = source.getContext("2d", { willReadFrequently: true })!;
  const img = sctx.getImageData(minX, minY, bw, bh);
  const px = img.data;

  // Ganho de balanço de branco a partir da referência (se houver)
  const gain = whiteRef
    ? { r: 245 / Math.max(1, whiteRef.r), g: 245 / Math.max(1, whiteRef.g), b: 245 / Math.max(1, whiteRef.b) }
    : { r: 1, g: 1, b: 1 };
  const clamp = (v: number) => Math.min(255, Math.max(0, v));

  type P = { idx: number; lab: Lab };
  const mouth: P[] = [];
  for (let i = 0; i < bw * bh; i++) {
    if (maskData[i * 4 + 3] < 128) continue;
    const lab = rgbToLab(clamp(px[i * 4] * gain.r), clamp(px[i * 4 + 1] * gain.g), clamp(px[i * 4 + 2] * gain.b));
    mouth.push({ idx: i, lab });
  }
  if (mouth.length < 150) throw new AnalysisError("Área da boca muito pequena. Aproxime a câmera do sorriso.");

  // 1) remove gengiva/língua/lábio (avermelhados ou saturados)
  const candidates = mouth.filter(
    (p) => p.lab.a < settings.maxRedness && Math.hypot(p.lab.a, p.lab.b) < settings.maxChroma && p.lab.L > 25,
  );
  // 2) mantém os mais claros (remove sombras entre dentes e interior escuro da boca)
  const Ls = candidates.map((p) => p.lab.L).sort((a, b) => a - b);
  const lo = percentile(Ls, settings.minLightnessPercentile);
  const hi = percentile(Ls, 97); // remove reflexos especulares
  const teeth = candidates.filter((p) => p.lab.L >= lo && p.lab.L <= hi);

  if (teeth.length < Math.max(60, mouth.length * 0.05))
    throw new AnalysisError("Não consegui isolar os dentes. Tente uma foto com mais luz e o sorriso mais aberto.");

  const measured: Lab = {
    L: median(teeth.map((p) => p.lab.L)),
    a: median(teeth.map((p) => p.lab.a)),
    b: median(teeth.map((p) => p.lab.b)),
  };

  // ---- Dados de simulação: Lab original e peso suave de cada pixel ----
  const labs = new Float32Array(bw * bh * 3);
  for (let i = 0; i < bw * bh; i++) {
    const l = rgbToLab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    labs[i * 3] = l.L;
    labs[i * 3 + 1] = l.a;
    labs[i * 3 + 2] = l.b;
  }
  const lowCut = percentile(Ls, Math.max(0, settings.minLightnessPercentile - 30));
  let toothWeights: Float32Array = new Float32Array(bw * bh);
  for (const p of mouth) {
    const { L, a, b } = p.lab;
    if (a >= settings.maxRedness + 4 || Math.hypot(a, b) >= settings.maxChroma + 6) continue;
    const redFade = Math.min(1, Math.max(0, (settings.maxRedness + 4 - a) / 6));
    const lightFade = lo > lowCut ? Math.min(1, Math.max(0, (L - lowCut) / (lo - lowCut))) : L >= lo ? 1 : 0;
    toothWeights[p.idx] = redFade * lightFade;
  }
  toothWeights = blur(blur(toothWeights, bw, bh), bw, bh);
  const rawTeeth = teeth.map((p) => p.idx);
  const raw: Lab = {
    L: median(rawTeeth.map((i) => labs[i * 3])),
    a: median(rawTeeth.map((i) => labs[i * 3 + 1])),
    b: median(rawTeeth.map((i) => labs[i * 3 + 2])),
  };

  const ranked = VITA_SHADES.map((shade) => ({
    shade,
    deltaE: deltaE2000(measured, shade.lab, settings.lightnessWeight),
  })).sort((a, b) => a.deltaE - b.deltaE);

  // Confiança relativa (softmax sobre -ΔE) entre todas as cores
  const tau = 1.5;
  const weights = ranked.map((r) => Math.exp(-r.deltaE / tau));
  const total = weights.reduce((s, w) => s + w, 0);
  const matches = ranked.slice(0, 3).map((r, i) => ({ ...r, confidence: weights[i] / total }));

  // Overlay: recorte com dentes realçados
  const pad = Math.round(Math.max(bw, bh) * 0.25);
  const cx = Math.max(0, minX - pad);
  const cy = Math.max(0, minY - pad);
  const cw = Math.min(W, maxX + pad) - cx;
  const ch = Math.min(H, maxY + pad) - cy;

  const crop = document.createElement("canvas");
  crop.width = cw;
  crop.height = ch;
  const cctx = crop.getContext("2d")!;
  cctx.drawImage(source, cx, cy, cw, ch, 0, 0, cw, ch);
  const cropUrl = crop.toDataURL("image/jpeg", 0.85);

  const hl = cctx.getImageData(minX - cx, minY - cy, bw, bh);
  const toothSet = new Uint8Array(bw * bh);
  teeth.forEach((p) => (toothSet[p.idx] = 1));
  for (let i = 0; i < bw * bh; i++) {
    if (!toothSet[i]) continue;
    hl.data[i * 4] = hl.data[i * 4] * 0.45 + 20 * 0.55;
    hl.data[i * 4 + 1] = hl.data[i * 4 + 1] * 0.45 + 153 * 0.55;
    hl.data[i * 4 + 2] = hl.data[i * 4 + 2] * 0.45 + 138 * 0.55;
  }
  cctx.putImageData(hl, minX - cx, minY - cy);
  cctx.strokeStyle = "#f59e0b";
  cctx.lineWidth = Math.max(1, cw / 300);
  cctx.beginPath();
  poly.forEach((p, i) => (i ? cctx.lineTo(p.x - cx, p.y - cy) : cctx.moveTo(p.x - cx, p.y - cy)));
  cctx.closePath();
  cctx.stroke();

  return {
    measured,
    matches,
    toothPixels: teeth.length,
    mouthPixels: mouth.length,
    overlay: crop.toDataURL("image/jpeg", 0.85),
    crop: cropUrl,
    sim: {
      source,
      box: { x: minX, y: minY, w: bw, h: bh },
      crop: { x: cx, y: cy, w: cw, h: ch },
      weights: toothWeights,
      labs,
      raw,
      poly,
    },
  };
}

/** Desfoque 3x3 (suaviza a borda da máscara para não ficar "recortado"). */
function blur(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          s += src[yy * w + xx];
          n++;
        }
      out[y * w + x] = s / n;
    }
  return out;
}

export type SimulationOptions = {
  /** Diferença Lab a aplicar (cor alvo − cor atual, na escala). */
  shift: Lab;
  /** 0 = mantém a textura natural; 1 = cor totalmente uniforme (porcelana). */
  uniformity: number;
};

/** Gera a foto simulada (inteira e recorte da boca) como data URLs. */
export function renderSimulation(sim: SimulationData, opts: SimulationOptions): SimImages {
  const { source, box, weights, labs, raw } = sim;
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(source, 0, 0);
  const img = ctx.getImageData(box.x, box.y, box.w, box.h);
  const d = img.data;
  const keep = 1 - opts.uniformity;
  for (let i = 0; i < box.w * box.h; i++) {
    const w = weights[i];
    if (w < 0.01) continue;
    const L = labs[i * 3];
    const a = labs[i * 3 + 1];
    const b = labs[i * 3 + 2];
    const target: Lab = {
      L: raw.L + (L - raw.L) * keep + opts.shift.L,
      a: raw.a + (a - raw.a) * keep + opts.shift.a,
      b: raw.b + (b - raw.b) * keep + opts.shift.b,
    };
    const rgb = labToRgb({ L: L + (target.L - L) * w, a: a + (target.a - a) * w, b: b + (target.b - b) * w });
    d[i * 4] = rgb.r;
    d[i * 4 + 1] = rgb.g;
    d[i * 4 + 2] = rgb.b;
  }
  ctx.putImageData(img, box.x, box.y);

  return exportImages(out, sim);
}

export type SimImages = {
  /** Foto inteira. */
  full: string;
  /** Recorte justo da boca (miniaturas). */
  zoom: string;
  /** Recorte quadrado da parte de baixo do rosto (comparação antes/depois). */
  view: string;
};

export type Rect = { x: number; y: number; w: number; h: number };

/** Quadrado em volta da boca, com nariz e queixo de contexto. */
export function viewRect(sim: SimulationData): Rect {
  const { box, source } = sim;
  const side = Math.min(Math.round(Math.max(box.w * 2.6, box.h * 3.2)), source.width, source.height);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const x = Math.round(Math.min(Math.max(0, cx - side / 2), source.width - side));
  const y = Math.round(Math.min(Math.max(0, cy - side / 2), source.height - side));
  return { x, y, w: side, h: side };
}

function cropTo(src: HTMLCanvasElement, r: Rect, maxW: number, quality: number): string {
  const c = document.createElement("canvas");
  const scale = Math.min(1, maxW / r.w);
  c.width = Math.round(r.w * scale);
  c.height = Math.round(r.h * scale);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

export function exportImages(out: HTMLCanvasElement, sim: SimulationData): SimImages {
  return {
    full: out.toDataURL("image/jpeg", 0.9),
    zoom: cropTo(out, sim.crop, 520, 0.8),
    view: cropTo(out, viewRect(sim), 1080, 0.9),
  };
}
