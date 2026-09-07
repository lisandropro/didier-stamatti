import type { NextConfig } from "next";

// Identifica esta compilación, y cambia con cada una.
//
// Es lo que permite que la app se actualice sola: la pantalla dibujada con un
// build compara contra el que corre el servidor y, si no coinciden, se recarga.
// NO se usa la variable de git de Railway porque **no existe en tiempo de
// ejecución**: sería siempre la misma y la app nunca se enteraría de un
// despliegue. Acá se calcula al compilar y Next lo deja fijo en el código, del
// lado del servidor y del navegador.
const BUILD_ID = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? String(Date.now());

const nextConfig: NextConfig = {
  env: { APP_BUILD_ID: BUILD_ID },
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

export default nextConfig;
