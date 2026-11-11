"use client"; // Las pantallas de error tienen que ser componentes de cliente.

import { useEffect } from "react";

/**
 * El último recurso: falló el armazón entero (el layout raíz).
 *
 * Reemplaza al documento completo, así que trae su propio <html> y <body>, y
 * NO recibe la hoja de estilos de la app: los colores van acá, a mano, con los
 * mismos valores que `public/sin-conexion.html` (claro y oscuro según el
 * teléfono, porque el tema elegido en Cuenta tampoco llega hasta acá).
 */
const ESTILOS = `
  :root{color-scheme:light dark; --fondo:#FBFAF8; --tinta:#141312; --suave:#6D6A64; --boton:#141312; --sobre-boton:#FFFFFF; --filete:#E7E4DE}
  @media (prefers-color-scheme:dark){:root{--fondo:#0E0E0D; --tinta:#F2F1ED; --suave:#9C9A93; --boton:#F2F1ED; --sobre-boton:#141312; --filete:#2E2E2A}}
  html,body{margin:0; height:100%; background:var(--fondo); color:var(--tinta); font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  main{min-height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:24px; box-sizing:border-box; text-align:center}
  h1{margin:0; font-size:22px}
  p{margin:0; max-width:36ch; color:var(--suave); line-height:1.45}
  button{min-height:48px; padding:0 28px; border-radius:12px; font-size:16px; font-weight:600; cursor:pointer; font-family:inherit}
  .principal{margin-top:12px; border:0; background:var(--boton); color:var(--sobre-boton)}
  .secundario{border:1px solid var(--filete); background:transparent; color:var(--tinta)}
  small{color:var(--suave)}
`;

export default function ErrorGlobal({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  function reintentar() {
    const otraVez = retry ?? reset;
    if (otraVez) otraVez();
    else window.location.reload();
  }

  return (
    <html lang="es">
      <head>
        <title>Algo falló · Didier Stamatti</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <style>{ESTILOS}</style>
      </head>
      <body>
        <main>
          <h1>Algo falló</h1>
          <p>No se pudo abrir la app. Puede ser la conexión o un problema del servidor: lo guardado no se pierde.</p>
          <button type="button" className="principal" onClick={reintentar}>
            Reintentar
          </button>
          <button
            type="button"
            className="secundario"
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- carga completa a propósito
            onClick={() => window.location.assign("/")}
          >
            Volver al inicio
          </button>
          {error.digest && <small>Código para avisar: {error.digest}</small>}
        </main>
      </body>
    </html>
  );
}
