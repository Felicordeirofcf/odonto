"use client";

import { useRef, useState } from "react";
import {
  Bot,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ScanFace,
  Send,
  Trash2,
  UserRound,
  Wifi,
} from "lucide-react";

export type StatusItem = { group: string; label: string; ok: boolean; detail: string; optional?: boolean };

type Turn = { role: "user" | "assistant"; text: string };
type Entry =
  | { kind: "turn"; turn: Turn; meta?: string }
  | { kind: "note"; text: string; tone: "handoff" | "error" };

/** Preço por milhão de tokens (US$): entrada, leitura de cache, saída. */
const PRICES: Record<string, [number, number, number]> = {
  opus: [4, 0.2, 20],
  sonnet: [2, 0.1, 10],
  haiku: [0.1, 0.01, 0.5],
};

function costUsd(model: string, u: { input: number; cached: number; output: number }) {
  const key = Object.keys(PRICES).find((k) => model.includes(k));
  if (!key) return null;
  const [i, c, o] = PRICES[key];
  return (u.input * i + u.cached * c + u.output * o) / 1e6;
}

export default function AdminDashboard({
  status,
  hasEvolution,
  hasClaude,
}: {
  status: StatusItem[];
  hasEvolution: boolean;
  hasClaude: boolean;
}) {
  const groups = [...new Set(status.map((s) => s.group))];

  const [evo, setEvo] = useState<{ busy: boolean; text: string | null; ok?: boolean }>({ busy: false, text: null });
  const checkEvolution = async () => {
    setEvo({ busy: true, text: null });
    const res = await fetch("/api/admin/evolution");
    const j = await res.json().catch(() => ({}));
    if (res.ok)
      setEvo({
        busy: false,
        ok: j.state === "open",
        text: j.state === "open" ? "Número conectado e pronto." : `Estado: ${j.state}. Leia o QR code no painel da Evolution.`,
      });
    else setEvo({ busy: false, ok: false, text: j.error || "Não consegui falar com a Evolution." });
  };

  const [name, setName] = useState("Julia");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const turns = (list: Entry[]) => list.flatMap((e) => (e.kind === "turn" ? [e.turn] : []));
  const scrollDown = () => setTimeout(() => listRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }), 50);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const next: Entry[] = [...entries, { kind: "turn", turn: { role: "user", text } }];
    setEntries(next);
    setDraft("");
    setBusy(true);
    scrollDown();
    try {
      const res = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns: turns(next), name }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEntries([...next, { kind: "note", tone: "error", text: j.error || "Falha ao chamar a IA." }]);
        return;
      }
      const usd = costUsd(j.model, j.usage);
      if (usd) setTotal((t) => t + usd);
      const meta = `${j.model} · ${j.usage.input + j.usage.cached} tokens de entrada (${j.usage.cached} em cache) · ${j.usage.output} de saída${
        usd !== null ? ` · ≈ US$ ${usd.toFixed(4)}` : ""
      }`;
      const out: Entry[] = [...next, { kind: "turn", turn: { role: "assistant", text: j.decision.resposta }, meta }];
      if (j.decision.encaminhar_para_equipe)
        out.push({
          kind: "note",
          tone: "handoff",
          text: `Encaminhado para a equipe${j.decision.motivo ? ` (${j.decision.motivo})` : ""}. ${
            j.decision.resumo_para_equipe ? `Resumo para a recepção: ${j.decision.resumo_para_equipe}. ` : ""
          }No WhatsApp de verdade, a IA para de responder nesta conversa.`,
        });
      setEntries(out);
    } finally {
      setBusy(false);
      scrollDown();
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Área administrativa</h1>
          <p className="text-sm text-gray-500">Teste tudo antes de levar para a clínica.</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700"
          >
            <ScanFace className="size-4" /> Simulação de sorriso
          </a>
          <button
            onClick={async () => {
              await fetch("/api/admin/login", { method: "DELETE" });
              location.reload();
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700"
          >
            <LogOut className="size-4" /> Sair
          </button>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Status */}
        <section className="space-y-4">
          {groups.map((g) => (
            <div key={g} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="font-semibold">{g}</h2>
              <ul className="mt-2 divide-y divide-gray-100">
                {status
                  .filter((s) => s.group === g)
                  .map((s) => (
                    <li key={s.label} className="flex gap-2.5 py-2.5">
                      {s.ok ? (
                        <CircleCheck className="mt-0.5 size-5 shrink-0 text-brand-600" aria-label="ok" />
                      ) : s.optional ? (
                        <CircleDashed className="mt-0.5 size-5 shrink-0 text-gray-400" aria-label="opcional" />
                      ) : (
                        <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-label="pendente" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{s.label}</div>
                        <div className="break-words text-xs text-gray-500">{s.detail}</div>
                      </div>
                    </li>
                  ))}
              </ul>
              {g === "Atendimento WhatsApp" && (
                <div className="mt-2">
                  <button
                    onClick={checkEvolution}
                    disabled={!hasEvolution || evo.busy}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
                  >
                    {evo.busy ? <LoaderCircle className="size-4 animate-spin" /> : <Wifi className="size-4" />}
                    Testar conexão do WhatsApp
                  </button>
                  {evo.text && (
                    <p className={`mt-2 text-sm ${evo.ok ? "text-brand-700" : "text-amber-700"}`}>{evo.text}</p>
                  )}
                </div>
              )}
            </div>
          ))}
          <p className="text-xs text-gray-500">
            Para mudar algo: Vercel → projeto odonto → Settings → Environment Variables, depois Redeploy.
          </p>
        </section>

        {/* Simulador do atendimento */}
        <section className="flex min-h-[560px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 p-4">
            <div className="flex size-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <Bot className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Testar a IA de atendimento</h2>
              <p className="text-xs text-gray-500">Escreva como se fosse um paciente. Nada é enviado no WhatsApp.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <UserRound className="size-4" />
              <span className="sr-only">Nome do paciente</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-28 rounded-lg border border-gray-200 px-2 py-1.5"
              />
            </label>
            <button
              onClick={() => {
                setEntries([]);
                setTotal(0);
              }}
              aria-label="Limpar conversa"
              className="rounded-lg border border-gray-200 p-2 text-gray-500"
            >
              <Trash2 className="size-4" />
            </button>
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-[#f7f8fa] p-4" style={{ maxHeight: 520 }}>
            {!hasClaude && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Falta a ANTHROPIC_API_KEY na Vercel para a IA responder.
              </p>
            )}
            {entries.length === 0 && (
              <div className="space-y-2 text-sm text-gray-500">
                <p>Sugestões para testar:</p>
                {[
                  "Oi, quanto custa clareamento?",
                  "Vi a simulação de sorriso no Instagram, como funciona?",
                  "Estou com muita dor no dente",
                  "Faz um desconto pra eu fechar hoje?",
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => setDraft(s)}
                    className="block rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-gray-700"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {entries.map((e, i) =>
              e.kind === "note" ? (
                <p
                  key={i}
                  className={`mx-auto max-w-[90%] rounded-xl px-3 py-2 text-center text-xs font-medium ${
                    e.tone === "handoff" ? "bg-violet-100 text-violet-900" : "bg-red-50 text-red-700"
                  }`}
                >
                  {e.text}
                </p>
              ) : e.turn.role === "user" ? (
                <div key={i} className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-gray-200 bg-white px-3 py-2 text-sm">
                  {e.turn.text}
                </div>
              ) : (
                <div key={i} className="ml-auto max-w-[80%]">
                  <div className="whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-brand-50 px-3 py-2 text-sm">{e.turn.text}</div>
                  {e.meta && <div className="mt-1 text-right text-[11px] text-gray-500">{e.meta}</div>}
                </div>
              ),
            )}
            {busy && (
              <div className="ml-auto flex w-fit items-center gap-2 rounded-2xl bg-brand-50 px-3 py-2 text-sm text-brand-700">
                <LoaderCircle className="size-4 animate-spin" /> digitando…
              </div>
            )}
          </div>

          <form onSubmit={send} className="flex gap-2 border-t border-gray-100 p-3">
            <label htmlFor="draft" className="sr-only">
              Mensagem do paciente
            </label>
            <input
              id="draft"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Mensagem do paciente…"
              className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-base outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Enviar"
              className="flex size-11 items-center justify-center rounded-xl bg-brand-700 text-white disabled:opacity-50"
            >
              <Send className="size-5" />
            </button>
          </form>
          {total > 0 && (
            <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
              <RefreshCw className="size-3.5" /> Custo estimado desta conversa: US$ {total.toFixed(4)}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
