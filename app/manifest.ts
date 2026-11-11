import type { MetadataRoute } from "next";

// Hace la app "instalable" (agregar a pantalla de inicio) con su ícono y nombre.
export default function manifest(): MetadataRoute.Manifest {
  return {
    // La identidad de la app instalada. Es la misma que ya tenía por defecto
    // (cuando falta, el navegador usa `start_url`): escribirla evita que un
    // cambio futuro de `start_url` la convierta en "otra app" y pida reinstalar.
    id: "/",
    name: "Didier Stamatti",
    // El nombre debajo del ícono: Android corta a los ~12 caracteres y
    // "Didier Stamatti" (15) quedaba en "Didier Stam…". El ícono ya dice el
    // nombre completo.
    short_name: "Didier",
    description: "Stock y pedidos — Didier Stamatti Catering",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Los dos en el negro del ícono (letras blancas sobre #141312): la pantalla
    // de arranque es el ícono sobre su mismo fondo, sin un recuadro alrededor.
    // Después manda el `themeColor` del layout, según el tema.
    background_color: "#141312",
    theme_color: "#141312",
    lang: "es-AR",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Mantener apretado el ícono en Android ofrece ir directo a Preparar.
    shortcuts: [{ name: "Preparar", short_name: "Preparar", url: "/preparar" }],
  };
}
