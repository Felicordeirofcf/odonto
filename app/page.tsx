import { ScanFace } from "lucide-react";
import SmileAnalyzer from "@/components/SmileAnalyzer";
import { CLINIC_NAME } from "@/lib/clinic";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-6">
      <header className="mb-5 flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          <ScanFace className="size-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold leading-tight">{CLINIC_NAME || "Análise de Sorriso"}</h1>
          <p className="text-sm text-gray-500">
            {CLINIC_NAME ? "Simulação de sorriso com IA" : "Cor dos dentes, clareamento e lentes · IA"}
          </p>
        </div>
      </header>
      <SmileAnalyzer />
    </main>
  );
}
