import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @react-pdf/renderer se usa en el servidor para generar los PDF; se deja como
  // paquete externo para que Next no intente empaquetarlo (evita errores de build).
  serverExternalPackages: ["@react-pdf/renderer", "web-push"],
};

export default nextConfig;
