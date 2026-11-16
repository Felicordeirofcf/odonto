import type { MetadataRoute } from "next";
import { APP_TITLE, CLINIC_NAME } from "@/lib/clinic";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_TITLE,
    short_name: CLINIC_NAME || "Odonto",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#14998a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
