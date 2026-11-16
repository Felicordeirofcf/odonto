import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Odonto · Análise de Sorriso",
    short_name: "Odonto",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#14998a",
  };
}
