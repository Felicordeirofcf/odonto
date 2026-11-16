// Copia os arquivos WASM do MediaPipe para public/ (servidos localmente, sem depender de CDN).
import { cpSync, mkdirSync, readdirSync } from "node:fs";
const src = "node_modules/@mediapipe/tasks-vision/wasm";
const dst = "public/mediapipe/wasm";
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) if (f.startsWith("vision_wasm_internal")) cpSync(`${src}/${f}`, `${dst}/${f}`);
console.log("MediaPipe WASM copiado para", dst);
