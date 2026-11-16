"use client";

import { useState } from "react";
import { LockKeyhole, LoaderCircle } from "lucide-react";

export default function AdminLogin({ configured }: { configured: boolean }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) location.reload();
    else {
      setError(j.error || "Não foi possível entrar.");
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex size-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <LockKeyhole className="size-6" />
        </div>
        <h1 className="mt-4 text-xl font-bold">Área administrativa</h1>
        <p className="mt-1 text-sm text-gray-500">Entre para testar a simulação e o atendimento com IA.</p>
        {!configured && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Defina a variável ADMIN_PASSWORD na Vercel e faça Redeploy.
          </p>
        )}
        <label htmlFor="pw" className="mt-5 block text-sm font-medium text-gray-700">
          Senha
        </label>
        <input
          id="pw"
          type="password"
          autoComplete="current-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={busy || !pw}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 py-3 font-semibold text-white disabled:opacity-50"
        >
          {busy && <LoaderCircle className="size-5 animate-spin" />}
          Entrar
        </button>
      </form>
    </main>
  );
}
