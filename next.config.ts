import type { NextConfig } from "next";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PHASE_PRODUCTION_SERVER } from "next/constants";

/**
 * Qué puede cargar una pantalla de la app, y desde dónde.
 *
 * Todo sale del propio servidor: no hay fuentes, imágenes ni scripts de
 * terceros. Con esto, si alguna vez se colara un texto que el navegador tomara
 * por código, no podría llamar a otro sitio ni mandar un formulario afuera.
 *
 * 'unsafe-inline' en scripts es necesario: Next arranca cada página con
 * scripts en línea, y el del tema (app/layout.tsx) corre antes del primer
 * dibujado. En estilos, por los atributos style de los componentes.
 */
const CONTENIDO_PERMITIDO = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

export default function config(phase: string): NextConfig {
  // Al arrancar se reutiliza la marca compilada. Calcular Date.now() aquí
  // haría que HTML, código del navegador y servidor tengan versiones distintas.
  const BUILD_ID: string = phase === PHASE_PRODUCTION_SERVER
    ? JSON.parse(readFileSync(join(process.cwd(), ".next/required-server-files.json"), "utf8")).config.env.APP_BUILD_ID
    : (process.env.DIDIER_BUILD_ID ??= (process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "local") + "-" + Date.now());

  const enProduccion = process.env.NODE_ENV === "production";

  const nextConfig: NextConfig = {
    env: { APP_BUILD_ID: BUILD_ID },
    deploymentId: BUILD_ID,
    // No hace falta anunciar con qué está hecha.
    poweredByHeader: false,
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
            // La app no usa cámara, micrófono ni ubicación: que nadie pueda
            // pedirlos en su nombre.
            { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
            // Solo en producción. En desarrollo Next recarga en caliente con
            // eval y un websocket, y no hay https que exigir.
            ...(enProduccion
              ? [
                  { key: "Content-Security-Policy", value: CONTENIDO_PERMITIDO },
                  // Un año entrando solo por https, aunque alguien escriba http.
                  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
                ]
              : []),
          ],
        },
      ];
    },
  };

  return nextConfig;
}
