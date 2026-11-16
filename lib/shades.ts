import type { Lab } from "./color";

/**
 * Escala VITA classical (16 cores).
 *
 * Valores CIELAB aproximados de referência. PODEM e DEVEM ser ajustados com o
 * cliente: o ideal é fotografar a escala física da clínica sob a mesma luz
 * usada nas fotos dos pacientes e substituir os números abaixo.
 */
export type Shade = {
  code: string;
  group: "A" | "B" | "C" | "D" | "BL";
  lab: Lab;
  /** Ordem de valor (luminosidade) recomendada pela VITA: 1 = mais claro. */
  valueOrder: number;
};

export const SHADE_GROUPS: Record<Shade["group"], string> = {
  A: "Marrom-avermelhado",
  B: "Amarelo-avermelhado",
  C: "Acinzentado",
  D: "Cinza-avermelhado",
  BL: "Bleach (extra branco)",
};

export const VITA_SHADES: Shade[] = [
  { code: "B1", group: "B", valueOrder: 1, lab: { L: 81.0, a: -1.2, b: 12.0 } },
  { code: "A1", group: "A", valueOrder: 2, lab: { L: 79.5, a: -0.3, b: 14.5 } },
  { code: "B2", group: "B", valueOrder: 3, lab: { L: 78.5, a: -0.6, b: 19.5 } },
  { code: "D2", group: "D", valueOrder: 4, lab: { L: 76.5, a: 0.3, b: 13.5 } },
  { code: "A2", group: "A", valueOrder: 5, lab: { L: 76.8, a: 0.6, b: 18.5 } },
  { code: "C1", group: "C", valueOrder: 6, lab: { L: 75.8, a: -0.2, b: 14.0 } },
  { code: "C2", group: "C", valueOrder: 7, lab: { L: 72.5, a: 0.8, b: 17.5 } },
  { code: "D4", group: "D", valueOrder: 8, lab: { L: 72.8, a: 0.8, b: 18.5 } },
  { code: "A3", group: "A", valueOrder: 9, lab: { L: 74.5, a: 1.2, b: 21.5 } },
  { code: "D3", group: "D", valueOrder: 10, lab: { L: 72.5, a: 1.2, b: 17.0 } },
  { code: "B3", group: "B", valueOrder: 11, lab: { L: 74.5, a: 0.8, b: 25.5 } },
  { code: "A3.5", group: "A", valueOrder: 12, lab: { L: 71.5, a: 2.3, b: 24.0 } },
  { code: "B4", group: "B", valueOrder: 13, lab: { L: 73.0, a: 1.5, b: 27.0 } },
  { code: "C3", group: "C", valueOrder: 14, lab: { L: 69.5, a: 1.3, b: 19.5 } },
  { code: "A4", group: "A", valueOrder: 15, lab: { L: 67.5, a: 3.2, b: 24.0 } },
  { code: "C4", group: "C", valueOrder: 16, lab: { L: 65.0, a: 2.5, b: 21.0 } },
];

/**
 * Cores "Bleach" (mais brancas que a B1), usadas em clareamento intenso e
 * lentes de contato. Valores aproximados — ajustáveis.
 */
export const BLEACH_SHADES: Shade[] = [
  { code: "BL1", group: "BL", valueOrder: -3, lab: { L: 92.0, a: -1.4, b: 4.5 } },
  { code: "BL2", group: "BL", valueOrder: -2, lab: { L: 90.0, a: -1.3, b: 6.5 } },
  { code: "BL3", group: "BL", valueOrder: -1, lab: { L: 88.0, a: -1.2, b: 8.5 } },
  { code: "BL4", group: "BL", valueOrder: 0, lab: { L: 85.0, a: -1.2, b: 10.0 } },
];

/** Todas as cores ordenadas da mais clara para a mais escura. */
export const ALL_SHADES_BY_VALUE: Shade[] = [...BLEACH_SHADES, ...VITA_SHADES].sort(
  (a, b) => a.valueOrder - b.valueOrder,
);

export const findShade = (code: string) => ALL_SHADES_BY_VALUE.find((s) => s.code === code);

/** Clareamento natural: sobe N posições na ordem de valor, sem passar da B1. */
export function naturalWhiteningTarget(current: Shade, steps = 5): Shade {
  const natural = ALL_SHADES_BY_VALUE.filter((s) => s.group !== "BL");
  const idx = natural.findIndex((s) => s.code === current.code);
  const target = natural[Math.max(0, idx - steps)];
  // se já está no topo da escala natural, sugere BL4
  return target.code === current.code ? BLEACH_SHADES[3] : target;
}
