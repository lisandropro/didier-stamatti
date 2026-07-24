import type { MetadataRoute } from "next";

// Hace la app "instalable" (agregar a pantalla de inicio) con su ícono y nombre.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Didier Stamatti",
    short_name: "Didier Stamatti",
    description: "Stock y pedidos — Didier Stamatti Catering",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#141312",
    theme_color: "#141312",
    lang: "es-AR",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
