import type { SimulationData } from "./analyze";

/**
 * Lente de contato com IA generativa.
 *
 * Só um recorte quadrado da boca é enviado ao servidor. O resultado é colado de
 * volta APENAS na região da boca (com borda suave), então o resto do rosto
 * continua idêntico à foto original.
 */

const SEND_SIZE = 1024;

export type LensAIResult = { full: string; zoom: string };
export type LensStyle = "natural" | "hollywood";

export class LensAIError extends Error {}

type Rect = { x: number; y: number; w: number; h: number };

function mouthSquare(sim: SimulationData): Rect {
  const { box, source } = sim;
  const side = Math.min(Math.round(Math.max(box.w, box.h * 1.6) * 2.2), source.width, source.height);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const x = Math.round(Math.min(Math.max(0, cx - side / 2), source.width - side));
  const y = Math.round(Math.min(Math.max(0, cy - side / 2), source.height - side));
  return { x, y, w: side, h: side };
}

/** Máscara suave: contorno da boca um pouco expandido + desfoque. */
function featheredMask(sim: SimulationData, W: number, H: number): HTMLCanvasElement {
  const { poly, box } = sim;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const grow = 1.08;
  const feather = Math.max(2, box.w * 0.035);

  // Desenha em resolução reduzida e amplia: funciona como desfoque em qualquer
  // navegador (o ctx.filter não existe em Safari antigo).
  const k = Math.max(1, feather / 1.5);
  const small = document.createElement("canvas");
  small.width = Math.ceil(W / k);
  small.height = Math.ceil(H / k);
  const s = small.getContext("2d")!;
  s.fillStyle = "#fff";
  s.beginPath();
  poly.forEach((p, i) => {
    const x = (cx + (p.x - cx) * grow) / k;
    const y = (cy + (p.y - cy) * grow) / k;
    if (i) s.lineTo(x, y);
    else s.moveTo(x, y);
  });
  s.closePath();
  s.fill();

  const mask = document.createElement("canvas");
  mask.width = W;
  mask.height = H;
  const m = mask.getContext("2d")!;
  m.imageSmoothingEnabled = true;
  m.imageSmoothingQuality = "high";
  m.drawImage(small, 0, 0, W, H);
  return mask;
}

export async function generateLensAI(
  sim: SimulationData,
  shadeCode: string,
  style: LensStyle,
  accessCode: string,
): Promise<LensAIResult> {
  const sq = mouthSquare(sim);
  const sendSide = SEND_SIZE; // amplia recortes pequenos: a IA trabalha melhor com mais pixels
  const send = document.createElement("canvas");
  send.width = sendSide;
  send.height = sendSide;
  send.getContext("2d")!.drawImage(sim.source, sq.x, sq.y, sq.w, sq.h, 0, 0, sendSide, sendSide);
  const image = send.toDataURL("image/jpeg", 0.92);

  let res: Response;
  try {
    res = await fetch("/api/lente", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessCode ? { "x-access-code": accessCode } : {}) },
      body: JSON.stringify({ image, shade: shadeCode, style }),
    });
  } catch {
    throw new LensAIError("Sem conexão com o servidor. Verifique a internet.");
  }
  const data = (await res.json().catch(() => ({}))) as { image?: string; error?: string };
  if (!res.ok || !data.image) throw new LensAIError(data.error || "A IA não conseguiu gerar a imagem. Tente de novo.");

  const gen = await loadImage(data.image);

  // Coloca a imagem gerada no lugar do recorte
  const W = sim.source.width;
  const H = sim.source.height;
  const layer = document.createElement("canvas");
  layer.width = W;
  layer.height = H;
  const l = layer.getContext("2d")!;
  l.drawImage(gen, sq.x, sq.y, sq.w, sq.h);
  // Mantém só a região da boca
  l.globalCompositeOperation = "destination-in";
  l.drawImage(featheredMask(sim, W, H), 0, 0);

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const o = out.getContext("2d")!;
  o.drawImage(sim.source, 0, 0);
  o.drawImage(layer, 0, 0);

  const { crop } = sim;
  const z = document.createElement("canvas");
  const scale = Math.min(1, 520 / crop.w);
  z.width = Math.round(crop.w * scale);
  z.height = Math.round(crop.h * scale);
  z.getContext("2d")!.drawImage(out, crop.x, crop.y, crop.w, crop.h, 0, 0, z.width, z.height);

  return { full: out.toDataURL("image/jpeg", 0.88), zoom: z.toDataURL("image/jpeg", 0.8) };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new LensAIError("Imagem gerada inválida."));
    img.src = src;
  });
}
