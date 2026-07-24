import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Didier Stamatti — Stock y Pedidos",
  description: "Control de stock y armado de pedidos por fin de semana",
  // Para que iPhone/Android la reconozcan como app instalable.
  applicationName: "Didier Stamatti",
  appleWebApp: { capable: true, title: "Didier Stamatti", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

// Aplica el tema y el tamaño de texto guardados ANTES del primer dibujado,
// para que no haya un parpadeo del tema equivocado al cargar.
const applyPrefs = `(function(){try{
var t=localStorage.getItem('didier-theme');
if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);
var s=localStorage.getItem('didier-text');
if(s==='grande'||s==='xl')document.documentElement.setAttribute('data-text',s);
}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <head>
        <script dangerouslySetInnerHTML={{ __html: applyPrefs }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
