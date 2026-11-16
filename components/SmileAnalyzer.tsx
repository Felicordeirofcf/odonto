"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Download,
  CircleCheck,
  History,
  ImageUp,
  LoaderCircle,
  Pipette,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Sparkles,
  SwitchCamera,
  Wand2,
  Trash2,
  X,
} from "lucide-react";
import {
  AnalysisError,
  DEFAULT_SETTINGS,
  analyzeSmile,
  loadLandmarker,
  renderSimulation,
  type AnalysisResult,
  type AnalysisSettings,
} from "@/lib/analyze";
import { labToCss, type RGB } from "@/lib/color";
import { LensAIError, generateLensAI, type AIQuality, type LensAIResult, type LensStyle } from "@/lib/lens-ai";
import type { SimImages } from "@/lib/analyze";
import BeforeAfter from "@/components/BeforeAfter";
import { ALL_SHADES_BY_VALUE, BLEACH_SHADES, SHADE_GROUPS, VITA_SHADES, findShade, naturalWhiteningTarget, type Shade } from "@/lib/shades";

type SimKey = "clareamento" | "orto" | "estetico";
const MODES: { key: SimKey; label: string; desc: string; ai: boolean }[] = [
  {
    key: "clareamento",
    label: "Clareamento",
    desc: "O mesmo sorriso, mais claro. Não muda o formato nem a posição dos dentes.",
    ai: false,
  },
  {
    key: "orto",
    label: "Ortodôntico",
    desc: "Simula os dentes alinhados (aparelho ou alinhador), mantendo a cor atual.",
    ai: true,
  },
  {
    key: "estetico",
    label: "Estético · Lentes",
    desc: "Melhora formato, cor e posição, e repõe dentes ausentes. Transformação completa.",
    ai: true,
  },
];
const modeLabel = (k: SimKey) => MODES.find((m) => m.key === k)!.label;
const LENS_OPTIONS = ["BL1", "BL2", "BL3", "BL4", "B1"];
const WHITENING_OPTIONS = ["BL2", "BL3", "BL4", ...VITA_SHADES.slice(0, 5).map((s) => s.code)]; // BL2..A2

const MAX_SIDE = 2048;
const HISTORY_KEY = "odonto.sorriso.historico";
const SETTINGS_KEY = "odonto.sorriso.ajustes";
const ACCESS_KEY = "odonto.sorriso.codigo";

type Saved = {
  id: string;
  patient: string;
  date: string;
  crop: string;
  shades: { code: string; confidence: number }[];
  sims?: { key: string; code: string; zoom: string }[];
  lab: { L: number; a: number; b: number };
};

function drawToCanvas(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext("2d", { willReadFrequently: true })!.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export default function SmileAnalyzer() {
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [patient, setPatient] = useState("");
  const [calibrating, setCalibrating] = useState(false);
  const [whiteRef, setWhiteRef] = useState<RGB | null>(null);
  const [settings, setSettings] = useState<AnalysisSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [history, setHistory] = useState<Saved[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [simTab, setSimTab] = useState<SimKey>("clareamento");
  const [whiteningCode, setWhiteningCode] = useState<string | null>(null);
  const [lensCode, setLensCode] = useState("BL2");
  const [lensStyle, setLensStyle] = useState<LensStyle>("natural");
  const [aiCache, setAiCache] = useState<Record<string, LensAIResult>>({});
  const [aiBusy, setAiBusy] = useState(false);
  const [aiQuality, setAiQuality] = useState<AIQuality>("high");
  const [aiStart, setAiStart] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [aiError, setAiError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [faceView, setFaceView] = useState<"rosto" | "sorriso">("rosto");
  const [accessCode, setAccessCode] = useState("");
  const [viewportH, setViewportH] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Carrega histórico/ajustes e pré-carrega o modelo de IA
  useEffect(() => {
    try {
      setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"));
      const s = localStorage.getItem(SETTINGS_KEY);
      if (s) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(s) });
      setAccessCode(localStorage.getItem(ACCESS_KEY) || "");
    } catch {}
    loadLandmarker().catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;
    setCameraError(null);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("Este navegador não libera a câmera (o site precisa estar em HTTPS).");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        setCameraError(
          e instanceof Error && e.name === "NotAllowedError"
            ? "Permissão da câmera negada. Libere o acesso nas configurações do navegador."
            : e instanceof Error
              ? e.message
              : "Não foi possível abrir a câmera.",
        );
      }
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [cameraOpen, facing, stopCamera]);

  // Enquanto a câmera está aberta: trava a rolagem e acompanha a altura real
  // da tela (barra do navegador, rotação do aparelho, teclado etc.).
  useEffect(() => {
    if (!cameraOpen) return;
    const html = document.documentElement;
    const prev = { html: html.style.overflow, body: document.body.style.overflow };
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    const update = () => setViewportH(Math.round(window.visualViewport?.height ?? window.innerHeight));
    update();
    window.visualViewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      html.style.overflow = prev.html;
      document.body.style.overflow = prev.body;
      window.visualViewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [cameraOpen]);

  const setNewPhoto = (c: HTMLCanvasElement) => {
    setPhoto(c);
    setPhotoUrl(c.toDataURL("image/jpeg", 0.9));
    setResult(null);
    setError(null);
    setWhiteRef(null);
    setCalibrating(false);
    setSavedId(null);
    setWhiteningCode(null);
    setSimTab("clareamento");
    setAiCache({});
    setAiError(null);
    setConsent(false);
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    let c = drawToCanvas(v, v.videoWidth, v.videoHeight);
    if (facing === "user") {
      // salva igual ao que o usuário viu (espelhado)
      const m = document.createElement("canvas");
      m.width = c.width;
      m.height = c.height;
      const ctx = m.getContext("2d", { willReadFrequently: true })!;
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(c, 0, 0);
      c = m;
    }
    setCameraOpen(false);
    setNewPhoto(c);
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      setNewPhoto(drawToCanvas(bmp, bmp.width, bmp.height));
    } catch {
      setError("Não consegui abrir esta imagem. Use JPG ou PNG.");
    }
  };

  const pickWhite = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!calibrating || !photo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * photo.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * photo.height);
    const r = 4;
    const d = photo
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(Math.max(0, x - r), Math.max(0, y - r), r * 2 + 1, r * 2 + 1).data;
    let R = 0, G = 0, B = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      R += d[i]; G += d[i + 1]; B += d[i + 2]; n++;
    }
    setWhiteRef({ r: R / n, g: G / n, b: B / n });
    setCalibrating(false);
    setResult(null);
  };

  const run = async () => {
    if (!photo) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setSavedId(null);
    setAiCache({});
    setAiError(null);
    try {
      setResult(await analyzeSmile(photo, settings, whiteRef));
    } catch (e) {
      setError(e instanceof AnalysisError ? e.message : "Falha ao carregar a IA. Verifique a conexão e tente de novo.");
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const current: Shade | null = result ? result.matches[0].shade : null;
  const whitening = current ? (whiteningCode && findShade(whiteningCode)) || naturalWhiteningTarget(current) : null;
  const lens = findShade(lensCode) ?? BLEACH_SHADES[1];

  const sims = useMemo(() => {
    if (!result || !current || !whitening) return null;
    const shift = (t: Shade) => ({ L: t.lab.L - current.lab.L, a: t.lab.a - current.lab.a, b: t.lab.b - current.lab.b });
    return {
      atual: renderSimulation(result.sim, { shift: { L: 0, a: 0, b: 0 }, uniformity: 0 }),
      clareamento: renderSimulation(result.sim, { shift: shift(whitening), uniformity: 0.15 }),
    };
  }, [result, current, whitening]);

  const aiKey = simTab === "orto" ? "orto" : `estetico|${lensCode}|${lensStyle}`;
  const isAI = simTab !== "clareamento";
  /** Imagem "depois" da simulação selecionada (null = IA ainda não gerada). */
  const after: SimImages | null = !sims ? null : isAI ? (aiCache[aiKey] ?? null) : sims.clareamento;
  const afterLabel =
    simTab === "clareamento"
      ? `Clareamento · ${whitening?.code ?? ""}`
      : simTab === "orto"
        ? "Ortodôntico"
        : `Lentes · ${lensCode}`;

  // cronômetro enquanto a IA gera
  useEffect(() => {
    if (!aiStart) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [aiStart]);

  const expectedSec = aiQuality === "high" ? 100 : 45;
  const elapsedSec = aiStart ? Math.max(0, Math.round((now - aiStart) / 1000)) : 0;
  // avança rápido no começo e desacelera, sem nunca "terminar" antes da resposta
  const progress = aiStart ? Math.min(0.96, 1 - Math.exp(-(elapsedSec / expectedSec) * 1.6)) : 0;

  const generateAI = async () => {
    if (!result) return;
    setAiBusy(true);
    setAiError(null);
    setAiStart(Date.now());
    // mantém a tela ligada durante a geração (se o navegador permitir)
    let lock: { release: () => Promise<void> } | null = null;
    try {
      lock = await (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null;
    } catch {}
    try {
      const r = await generateLensAI(
        result.sim,
        { mode: simTab === "orto" ? "ortho" : "cosmetic", shade: lensCode, style: lensStyle, quality: aiQuality },
        accessCode,
      );
      setAiCache((c) => ({ ...c, [aiKey]: r }));
      setSavedId(null);
    } catch (e) {
      setAiError(e instanceof LensAIError ? e.message : "Falha ao gerar a simulação com IA.");
      console.error(e);
    } finally {
      setAiBusy(false);
      setAiStart(null);
      lock?.release().catch(() => {});
    }
  };

  const save = () => {
    if (!result) return;
    const entry: Saved = {
      id: crypto.randomUUID(),
      patient: patient.trim() || "Sem nome",
      date: new Date().toISOString(),
      crop: result.crop,
      shades: result.matches.map((m) => ({ code: m.shade.code, confidence: m.confidence })),
      lab: result.measured,
      sims: sims
        ? [
            { key: "Atual", code: current?.code ?? "", zoom: sims.atual.zoom },
            { key: "Clareamento", code: whitening?.code ?? "", zoom: sims.clareamento.zoom },
            ...Object.entries(aiCache).map(([k, v]) => ({
              key: k === "orto" ? "Ortodôntico" : "Lentes",
              code: k.split("|")[1] ?? "",
              zoom: v.zoom,
            })),
          ]
        : undefined,
    };
    const next = [entry, ...history].slice(0, 20);
    setHistory(next);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      // armazenamento cheio: guarda só os mais recentes
      const small = next.slice(0, 5);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(small));
      setHistory(small);
    }
    setSavedId(entry.id);
  };

  const removeSaved = (id: string) => {
    const next = history.filter((h) => h.id !== id);
    setHistory(next);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  };

  return (
    <div className="space-y-5">
      {/* Paciente */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <label className="text-sm font-medium text-gray-600" htmlFor="patient">
          Paciente
        </label>
        <input
          id="patient"
          value={patient}
          onChange={(e) => setPatient(e.target.value)}
          placeholder="Nome do paciente (opcional)"
          className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </section>

      {/* Captura */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-lg font-semibold">1. Foto do sorriso</h2>
        <p className="mt-1 text-sm text-gray-500">
          De frente, sorriso aberto mostrando os dentes, luz natural e sem flash.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            onClick={() => setCameraOpen(true)}
            className="flex flex-col items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3 py-4 font-medium text-brand-700 active:scale-[0.98]"
          >
            <Camera className="size-7" />
            Tirar foto agora
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-4 font-medium text-gray-700 active:scale-[0.98]"
          >
            <ImageUp className="size-7" />
            Enviar imagem
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>

        {photoUrl && (
          <div className="mt-4 space-y-3">
            <div className="relative overflow-hidden rounded-xl bg-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl}
                alt="Foto do paciente"
                onClick={pickWhite}
                className={`mx-auto max-h-[60vh] w-auto ${calibrating ? "cursor-crosshair" : ""}`}
              />
              {calibrating && (
                <div className="absolute inset-x-0 top-0 bg-amber-500/90 px-3 py-2 text-center text-sm font-medium text-white">
                  Toque numa área BRANCA de referência (papel, cartão cinza/branco)
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button
                onClick={() => setCalibrating((c) => !c)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 ${
                  calibrating ? "border-amber-400 bg-amber-50 text-amber-700" : "border-gray-200 text-gray-600"
                }`}
              >
                <Pipette className="size-4" />
                {whiteRef ? "Recalibrar branco" : "Calibrar com branco (opcional)"}
              </button>
              {whiteRef && (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-2 text-brand-700">
                  <span
                    className="size-4 rounded border border-gray-300"
                    style={{ background: `rgb(${whiteRef.r},${whiteRef.g},${whiteRef.b})` }}
                  />
                  Calibrado
                  <button onClick={() => setWhiteRef(null)} aria-label="Remover calibração">
                    <X className="size-4" />
                  </button>
                </span>
              )}
            </div>

            <button
              onClick={run}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-3.5 text-base font-semibold text-white shadow-sm active:scale-[0.99] disabled:opacity-60"
            >
              {busy ? <LoaderCircle className="size-5 animate-spin" /> : <RefreshCw className="size-5" />}
              {busy ? "Analisando sorriso…" : result ? "Analisar novamente" : "Analisar cor dos dentes"}
            </button>
          </div>
        )}

        {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
      </section>

      {/* Simulação */}
      {result && sims && (
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="size-5 text-brand-600" /> 2. Simulação do sorriso
          </h2>

          {/* Tipo de simulação */}
          <div className="mt-3 space-y-2">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => {
                  setSimTab(m.key);
                  setAiError(null);
                }}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${
                  simTab === m.key ? "border-brand-500 bg-brand-50" : "border-gray-200"
                }`}
              >
                <span
                  className={`size-4 shrink-0 rounded-full border-2 ${
                    simTab === m.key ? "border-brand-500 bg-brand-500 ring-2 ring-inset ring-white" : "border-gray-300"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className={`font-semibold ${simTab === m.key ? "text-brand-700" : "text-gray-800"}`}>
                    {m.label}
                  </span>
                  <span className="block text-xs leading-snug text-gray-500">{m.desc}</span>
                </span>
                {m.ai && (
                  <span className="shrink-0 rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">
                    IA
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Opções do tipo escolhido */}
          {simTab === "clareamento" && (
            <ShadePicker
              label="Cor final do clareamento"
              options={WHITENING_OPTIONS}
              value={whitening?.code ?? ""}
              onChange={setWhiteningCode}
            />
          )}
          {simTab === "estetico" && (
            <>
              <div className="mt-3">
                <div className="text-sm font-medium text-gray-600">Estilo</div>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {(
                    [
                      ["natural", "Natural", "Formato real, discreto"],
                      ["hollywood", "Hollywood", "Alinhado e uniforme"],
                    ] as const
                  ).map(([k, label, hint]) => (
                    <button
                      key={k}
                      onClick={() => setLensStyle(k)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm ${
                        lensStyle === k ? "border-brand-500 bg-brand-50 text-brand-700" : "border-gray-200 text-gray-600"
                      }`}
                    >
                      <span className="font-semibold">{label}</span>
                      <span className="block text-xs opacity-70">{hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              <ShadePicker label="Cor da lente" options={LENS_OPTIONS} value={lensCode} onChange={setLensCode} />
            </>
          )}

          {/* Antes / depois */}
          {after ? (
            <>
              <BeforeAfter
                key={`${simTab}-${faceView}`}
                before={faceView === "rosto" ? sims.atual.full : sims.atual.view}
                after={faceView === "rosto" ? after.full : after.view}
                label={afterLabel}
                aspect={faceView === "rosto" && photo ? photo.width / photo.height : 1}
              />
              <p className="mt-1.5 text-center text-xs text-gray-400">Arraste a linha para comparar antes e depois</p>
              <div className="mt-2 flex justify-center">
                <span className="inline-flex overflow-hidden rounded-lg border border-gray-200 text-sm font-medium">
                  {(["rosto", "sorriso"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setFaceView(v)}
                      className={`px-3 py-1.5 ${faceView === v ? "bg-brand-500 text-white" : "bg-white text-gray-600"}`}
                    >
                      {v === "rosto" ? "Rosto inteiro" : "Só o sorriso"}
                    </button>
                  ))}
                </span>
              </div>
            </>
          ) : (
            // IA ainda não gerada para esta opção
            <div className="relative mt-3 overflow-hidden rounded-2xl border-2 border-dashed border-violet-300">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sims.atual.view} alt="Foto atual" className="aspect-square w-full object-cover opacity-60" />
              <div className="absolute inset-0 flex items-center justify-center bg-white/40 p-4 text-center text-sm font-medium text-violet-900">
                {aiBusy ? (
                  <div className="w-full max-w-xs">
                    <div className="text-base font-semibold">Gerando simulação…</div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-violet-100">
                      <div
                        className="h-full rounded-full bg-violet-600 transition-[width] duration-500"
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    </div>
                    <div className="mt-2 text-xs font-normal">
                      {elapsedSec} s · costuma levar {aiQuality === "high" ? "1 a 2 min" : "30 a 60 s"}. Mantenha o app
                      aberto.
                    </div>
                  </div>
                ) : (
                  "Toque em “Gerar simulação” abaixo"
                )}
              </div>
            </div>
          )}

          {isAI && (
            <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
              <p className="text-xs text-violet-900/70">
                A IA redesenha só os dentes. Apenas a parte de baixo do rosto é enviada; o restante da foto continua
                igual.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                {(
                  [
                    ["high", "Máxima qualidade", "~1,5 min"],
                    ["medium", "Rápida", "~40 s"],
                  ] as const
                ).map(([q, label, hint]) => (
                  <button
                    key={q}
                    onClick={() => setAiQuality(q)}
                    disabled={aiBusy}
                    className={`rounded-lg border px-3 py-2 text-left ${
                      aiQuality === q ? "border-violet-500 bg-white text-violet-800" : "border-violet-200 text-violet-900/70"
                    }`}
                  >
                    <span className="font-semibold">{label}</span>
                    <span className="block text-xs opacity-70">{hint}</span>
                  </button>
                ))}
              </div>
              {!after && (
                <label className="mt-2 flex items-start gap-2 text-sm text-violet-900">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 size-4 accent-violet-600"
                  />
                  O paciente autorizou o envio da foto para a simulação.
                </label>
              )}
              <button
                onClick={generateAI}
                disabled={aiBusy || !consent}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white disabled:opacity-50"
              >
                {aiBusy ? <LoaderCircle className="size-5 animate-spin" /> : <Wand2 className="size-5" />}
                {aiBusy ? `Gerando… ${elapsedSec} s` : after ? "Gerar outra versão" : "Gerar simulação"}
              </button>
              {aiError && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{aiError}</p>}
            </div>
          )}

          {after && (
            <button
              onClick={() =>
                shareBeforeAfter(
                  faceView === "rosto" ? sims.atual.full : sims.atual.view,
                  faceView === "rosto" ? after.full : after.view,
                  afterLabel,
                  patient.trim(),
                )
              }
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 font-semibold text-gray-700"
            >
              <Download className="size-5" /> Baixar / enviar antes e depois
            </button>
          )}

          <p className="mt-3 text-xs text-gray-400">
            Simulação ilustrativa. O resultado real depende da avaliação clínica.
          </p>
        </section>
      )}

      {/* Resultado */}
      {result && (
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-lg font-semibold">3. Cor atual identificada</h2>
          <p className="mt-1 text-sm text-gray-500">As 3 cores da escala VITA mais próximas do sorriso.</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {result.matches.map((m, i) => (
              <div
                key={m.shade.code}
                className={`rounded-xl border p-3 ${i === 0 ? "border-brand-500 bg-brand-50" : "border-gray-200"}`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-14 w-10 shrink-0 rounded-b-[40%] rounded-t-md border border-gray-300 shadow-inner"
                    style={{ background: labToCss(m.shade.lab) }}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      {i === 0 ? "Mais provável" : `${i + 1}ª opção`}
                    </div>
                    <div className="text-2xl font-bold">{m.shade.code}</div>
                    <div className="truncate text-xs text-gray-500">{SHADE_GROUPS[m.shade.group]}</div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-lg font-semibold text-brand-700">{Math.round(m.confidence * 100)}%</div>
                    <div className="text-[11px] text-gray-400">ΔE {m.deltaE.toFixed(1)}</div>
                  </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
                  <div className="h-full bg-brand-500" style={{ width: `${Math.round(m.confidence * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto]">
            <div>
              <div className="text-sm font-medium text-gray-600">Área analisada (em verde)</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.overlay} alt="Dentes detectados" className="mt-1 w-full max-w-md rounded-xl border" />
            </div>
            <div className="text-sm text-gray-600">
              <div className="font-medium">Cor medida</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="size-8 rounded-lg border" style={{ background: labToCss(result.measured) }} />
                <span className="font-mono text-xs">
                  L {result.measured.L.toFixed(1)} · a {result.measured.a.toFixed(1)} · b {result.measured.b.toFixed(1)}
                </span>
              </div>
              <div className="mt-2 text-xs text-gray-400">
                {result.toothPixels.toLocaleString("pt-BR")} pixels de dente
              </div>
            </div>
          </div>

          <button
            onClick={save}
            disabled={!!savedId}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-brand-500 px-4 py-3 font-semibold text-brand-700 disabled:border-gray-200 disabled:text-gray-400"
          >
            {savedId ? <CircleCheck className="size-5" /> : <Save className="size-5" />}
            {savedId ? "Salvo no histórico" : "Salvar no histórico"}
          </button>

          <p className="mt-3 text-xs text-gray-400">
            Estimativa por foto: iluminação e câmera alteram a cor. Confirme sempre com a escala física.
          </p>
        </section>
      )}

      {/* Ajustes finos */}
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <button
          onClick={() => setShowSettings((s) => !s)}
          className="flex w-full items-center gap-2 px-4 py-3.5 text-left font-medium sm:px-5"
        >
          <SlidersHorizontal className="size-5 text-gray-500" />
          Ajustes da IA
          <span className="ml-auto text-xs text-gray-400">{showSettings ? "fechar" : "abrir"}</span>
        </button>
        {showSettings && (
          <div className="space-y-4 border-t border-gray-100 px-4 pb-5 pt-4 sm:px-5">
            {(
              [
                ["maxRedness", "Tolerância a vermelho (gengiva)", 0, 30, 1],
                ["maxChroma", "Saturação máxima", 15, 60, 1],
                ["minLightnessPercentile", "Corte de sombras (%)", 0, 80, 1],
                ["lightnessWeight", "Peso do brilho (1 = calibrado, 2–3 = foto comum)", 1, 4, 0.1],
              ] as const
            ).map(([key, label, min, max, step]) => (
              <label key={key} className="block text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>{label}</span>
                  <span className="font-mono">{settings[key]}</span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={settings[key]}
                  onChange={(e) => setSettings((s) => ({ ...s, [key]: Number(e.target.value) }))}
                  className="mt-1 w-full accent-brand-500"
                />
              </label>
            ))}
            <label className="block text-sm">
              <span className="text-gray-600">Código de acesso da IA generativa (se a clínica definiu um)</span>
              <input
                value={accessCode}
                onChange={(e) => {
                  setAccessCode(e.target.value);
                  localStorage.setItem(ACCESS_KEY, e.target.value);
                }}
                type="password"
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2"
              />
            </label>
            <button onClick={() => setSettings(DEFAULT_SETTINGS)} className="text-sm text-brand-700 underline">
              Restaurar padrão
            </button>
            <details className="text-sm text-gray-600">
              <summary className="cursor-pointer">Escala VITA de referência</summary>
              <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-8">
                {VITA_SHADES.map((s) => (
                  <div key={s.code} className="text-center text-xs">
                    <div className="mx-auto h-8 w-6 rounded-b-[40%] rounded-t border" style={{ background: labToCss(s.lab) }} />
                    {s.code}
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </section>

      {/* Histórico */}
      {history.length > 0 && (
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <History className="size-5 text-gray-500" /> Histórico
          </h2>
          <ul className="mt-3 divide-y divide-gray-100">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-3 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={h.sims?.[h.sims.length - 1]?.zoom ?? h.crop} alt="" className="h-12 w-16 rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{h.patient}</div>
                  <div className="text-xs text-gray-500">
                    {new Date(h.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                </div>
                <div className="flex gap-1">
                  {h.shades.map((s, i) => (
                    <span
                      key={s.code}
                      className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${
                        i === 0 ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {s.code}
                    </span>
                  ))}
                </div>
                <button onClick={() => removeSaved(h.id)} aria-label="Excluir" className="p-1 text-gray-400">
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Câmera em tela cheia — ocupa exatamente a área visível de qualquer celular */}
      {cameraOpen && (
        <div
          className="fixed left-0 top-0 z-50 w-full touch-none overflow-hidden bg-black"
          style={{ height: viewportH ? `${viewportH}px` : "100dvh" }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`absolute inset-0 h-full w-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`}
          />

          {/* Guia de enquadramento (acima da barra de botões) */}
          <div className="pointer-events-none absolute inset-x-0 top-0 bottom-[calc(7.5rem+env(safe-area-inset-bottom))] flex items-center justify-center">
            <div className="aspect-[3/4] h-[min(78%,95vw)] max-h-[34rem] rounded-[50%] border-4 border-dashed border-white/70" />
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))] text-center text-sm font-medium text-white">
            Enquadre o rosto no oval e peça um sorriso aberto
          </div>

          {cameraError && (
            <div className="absolute inset-x-4 top-1/3 rounded-xl bg-white p-4 text-center text-sm text-red-700">
              {cameraError}
            </div>
          )}

          {/* Botões sempre visíveis, por cima do vídeo */}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-around bg-gradient-to-t from-black/80 via-black/50 to-transparent px-6 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.75rem))] pt-10">
            <button
              onClick={() => setCameraOpen(false)}
              className="flex size-14 items-center justify-center rounded-full bg-black/40 text-white"
              aria-label="Fechar"
            >
              <X className="size-7" />
            </button>
            <button
              onClick={capture}
              aria-label="Capturar"
              className="flex size-20 items-center justify-center rounded-full border-4 border-white active:scale-95"
            >
              <span className="size-16 rounded-full bg-white/90" />
            </button>
            <button
              onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
              className="flex size-14 items-center justify-center rounded-full bg-black/40 text-white"
              aria-label="Trocar câmera"
            >
              <SwitchCamera className="size-7" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ShadePicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (code: string) => void;
}) {
  return (
    <div className="mt-3">
      <div className="text-sm font-medium text-gray-600">{label}</div>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {options.map((code) => {
          const shade = ALL_SHADES_BY_VALUE.find((s) => s.code === code)!;
          return (
            <button
              key={code}
              onClick={() => onChange(code)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-semibold ${
                value === code ? "border-brand-500 bg-brand-50 text-brand-700" : "border-gray-200 text-gray-600"
              }`}
            >
              <span className="h-5 w-4 rounded-b-[40%] rounded-t-sm border" style={{ background: labToCss(shade.lab) }} />
              {code}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Monta uma imagem lado a lado (antes | depois) e compartilha (WhatsApp etc.) ou baixa. */
async function shareBeforeAfter(before: string, after: string, label: string, patient: string) {
  const load = (src: string) =>
    new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = fail;
      i.src = src;
    });
  const [a, b] = await Promise.all([load(before), load(after)]);
  const W = Math.min(1080, a.naturalWidth);
  const H = Math.round((W * a.naturalHeight) / a.naturalWidth);
  const gap = Math.round(W * 0.02);
  const bar = Math.round(W * 0.11);
  const c = document.createElement("canvas");
  c.width = W * 2 + gap;
  c.height = H + bar;
  const x = c.getContext("2d")!;
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(a, 0, 0, W, H);
  x.drawImage(b, W + gap, 0, W, H);
  x.fillStyle = "#1f2328";
  x.font = `600 ${Math.round(bar * 0.4)}px system-ui, sans-serif`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText("Antes", W / 2, H + bar / 2);
  x.fillStyle = "#0f8275";
  x.fillText(label, W + gap + W / 2, H + bar / 2);

  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.92));
  if (!blob) return;
  const name = `sorriso-${(patient || "simulacao").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.jpg`;
  const file = new File([blob], name, { type: "image/jpeg" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "Simulação do sorriso" });
      return;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return; // usuário cancelou
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
