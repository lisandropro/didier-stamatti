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
    experimental: {
      // El default de Next son 1 MB, y la captura valida hasta 8 MB: una foto
      // densa fallaba con un error de plataforma opaco ANTES de llegar a la
      // validación propia. Los dos números tienen que ser el mismo.
      serverActions: { bodySizeLimit: "10mb" },
    },
    async headers() {
      return [
        {
          source: "/:path*",
          headers: [
            // Las fotos se sirven con el Content-Type que declaró quien subió.
            // Sin esto el navegador puede adivinar otro y ejecutar lo que no es
            // una imagen.
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
