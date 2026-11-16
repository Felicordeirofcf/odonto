# Odonto — Análise de Sorriso com IA

Primeiro módulo do CRM odontológico. A pessoa tira uma foto (câmera ao vivo) ou envia uma imagem, e o sistema:

1. **Encontra a boca** com IA (MediaPipe Face Landmarker, roda no próprio aparelho — a foto não sai do celular).
2. **Isola os dentes** (descarta lábios, gengiva, língua e sombras).
3. **Identifica a cor atual** — as 3 cores mais próximas da escala VITA, com % de confiança.
4. **Simula 3 versões do sorriso**:
   - **Sem lente (atual)**
   - **Clareamento natural** (sobe ~5 tons na escala, mantendo a textura natural; tom final ajustável)
   - **Com lente** (cores BL1–BL4/B1, acabamento mais uniforme, tipo porcelana)

## Rodar localmente

```bash
npm install
npm run dev
```

Abra http://localhost:3000. Para usar a câmera no celular o site precisa estar em **HTTPS** (ex.: deploy na Vercel).

## Onde ajustar com o cliente

- `lib/shades.ts` — valores de cor (CIELAB) da escala VITA e das cores BL. O ideal é fotografar a escala física da clínica, com a mesma luz das fotos, e substituir os números.
- `lib/shades.ts` → `naturalWhiteningTarget` — quantos tons o clareamento natural sobe.
- `components/SmileAnalyzer.tsx` → `LENS_OPTIONS`, `WHITENING_OPTIONS` e `uniformity` (0,15 clareamento / 0,6 lente).
- Na própria tela, **"Ajustes da IA"** permite calibrar a detecção (tolerância a gengiva, sombras, peso do brilho) — fica salvo no navegador.
- **Calibrar com branco**: toque num papel branco na foto para corrigir a iluminação.

O histórico de análises fica salvo no navegador (localStorage) por enquanto; vai para o banco de dados quando o CRM for montado.
