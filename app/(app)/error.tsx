"use client"; // Las pantallas de error tienen que ser componentes de cliente.

import { useEffect } from "react";

/**
 * Lo que se ve cuando una pantalla falla al cargar (la base no contestó, se
 * cortó la conexión a mitad del pedido, un error que nadie previó).
 *
 * Sin esto salía la pantalla de Next: blanca, en inglés y sin ningún botón. En
 * la app instalada no hay barra del navegador para recargar, así que la única
 * salida era cerrarla. Queda adentro del armazón: el menú sigue a mano.
 *
 * Next 16 pasa `retry` (vuelve a pedir la pantalla al servidor); `reset` es el
 * de las versiones anteriores y queda de respaldo.
 */
export default function ErrorDePantalla({
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
    <>
      <div className="topbar">
        <div>
          <h1>No se pudo abrir esta pantalla</h1>
          <div className="sub">No es algo que hayas hecho mal</div>
        </div>
      </div>
      <div className="content">
        <div className="empty-card" role="alert">
          <p className="empty-title">Algo falló al cargar</p>
          <p>
            Puede ser la conexión o un problema del servidor. Lo que ya estaba guardado no se pierde. Probá de
            nuevo; si sigue pasando, avisale a quien administra la app.
          </p>
          <button type="button" className="btn primary" onClick={reintentar}>
            Reintentar
          </button>
          {/* Carga completa y no un enlace de la app: después de un error conviene
              arrancar de cero. */}
          <button
            type="button"
            className="btn ghost"
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- carga completa a propósito
            onClick={() => window.location.assign("/")}
          >
            Volver al inicio
          </button>
          {error.digest && <p className="error-codigo">Código para avisar: {error.digest}</p>}
        </div>
      </div>
    </>
  );
}
