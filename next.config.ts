import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // o atendimento lê config/atendimento.md em tempo de execução
  outputFileTracingIncludes: { "/api/whatsapp": ["./config/**"] },
  // Postgres em memória usado só nos testes locais
  serverExternalPackages: ["@electric-sql/pglite"],
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
