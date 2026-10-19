import type { NextConfig } from "next";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PHASE_PRODUCTION_SERVER } from "next/constants";

export default function config(phase: string): NextConfig {
  // Al arrancar se reutiliza la marca compilada. Calcular Date.now() aquí
  // haría que HTML, código del navegador y servidor tengan versiones distintas.
  const BUILD_ID: string = phase === PHASE_PRODUCTION_SERVER
    ? JSON.parse(readFileSync(join(process.cwd(), ".next/required-server-files.json"), "utf8")).config.env.APP_BUILD_ID
    : (process.env.DIDIER_BUILD_ID ??= (process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "local") + "-" + Date.now());

  const nextConfig: NextConfig = {
    env: { APP_BUILD_ID: BUILD_ID },
    deploymentId: BUILD_ID,
    // @react-pdf/renderer se usa en el servidor para generar los PDF; se deja como
    // paquete externo para que Next no intente empaquetarlo (evita errores de build).
    serverExternalPackages: ["@react-pdf/renderer", "web-push"],
    async headers() {
      return [
        {
          source: "/:path*",
          headers: [
            // Que el navegador respete el Content-Type declarado (los PDF, por
            // ejemplo) en vez de adivinar otro.
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
            { key: "X-Frame-Options", value: "SAMEORIGIN" },
          ],
        },
      ];
    },
  };

  return nextConfig;
}
