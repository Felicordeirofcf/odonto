import type { Metadata } from "next";
import "./globals.css";

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#14998a" };

export const metadata: Metadata = {
  title: "Odonto · Análise de Sorriso",
  description: "Identificação da cor dos dentes por IA (escala VITA)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
