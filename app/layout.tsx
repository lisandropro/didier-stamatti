import type { Metadata, Viewport } from "next";
import { ComportamientoDeApp } from "@/components/ComportamientoDeApp";
import "./globals.css";

export const metadata: Metadata = {
  title: "Didier Stamatti — Stock y Pedidos",
  description: "Control de stock y armado de pedidos por período operativo",
  // Para que iPhone/Android la reconozcan como app instalable.
  applicationName: "Didier Stamatti",
  appleWebApp: { capable: true, title: "Didier Stamatti", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

// Una app no se agranda con el pellizco: la pantalla se movía y "se achicaba"
// en el teléfono. Quien necesite letra más grande la elige en Cuenta, que
// agranda todo sin romper el diseño. El color de la barra del sistema sale del
// fondo de cada tema (y `ComportamientoDeApp` lo ajusta al tema elegido).
// `interactiveWidget`: en Android el teclado, por defecto, se pone ENCIMA de lo
// que está fijo abajo (las hojas), y un campo de la hoja podía quedar tapado.
// Con "resizes-content" la pantalla se achica al abrirse el teclado y lo fijo
// abajo queda arriba del teclado, como en una app.
//
// `viewportFit: "cover"`: sin esto, en iPhone `env(safe-area-inset-*)` vale 0 y
// lo que va pegado abajo no sabe dónde está la barra de gestos ni las esquinas
// redondeadas de la pantalla. Así la barra de abajo y las hojas se apartan solas.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBFAF8" },
    { media: "(prefers-color-scheme: dark)", color: "#0E0E0D" },
  ],
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
      <body>
        <ComportamientoDeApp />
        {children}
      </body>
    </html>
  );
}
