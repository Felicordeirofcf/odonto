import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // o atendimento lê config/atendimento.md em tempo de execução
  outputFileTracingIncludes: { "/api/whatsapp": ["./config/**"] },
};

export default nextConfig;
