import type { Metadata } from "next";
import "./globals.css";
import { APP_TITLE, CLINIC_NAME } from "@/lib/clinic";

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#14998a" };

export const metadata: Metadata = {
  title: APP_TITLE,
  appleWebApp: { capable: true, title: CLINIC_NAME || "Odonto", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  description: "Identificação da cor dos dentes por IA (escala VITA)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
