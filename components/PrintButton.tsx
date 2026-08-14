"use client";

import { imprimirParte } from "@/components/PrintablePedido";

const IconPrint = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M7 8V3.5h10V8M7 17h10v3.5H7z" />
    <path d="M4.5 8h15a1.5 1.5 0 0 1 1.5 1.5V16h-4M3 16h4M3 9.5A1.5 1.5 0 0 1 4.5 8" />
  </svg>
);

const IconCartel = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="2.5" y="5" width="19" height="12" rx="1.5" />
    <path d="M12 17v3M8.5 20h7" />
  </svg>
);

/**
 * Dos botones, porque son dos trabajos distintos.
 *
 * El pedido se imprime en A4 vertical y se lo lleva quien arma; los cartelitos
 * van apaisados y se pegan en cada sector del depósito. Antes un solo botón
 * mandaba todo junto: para reimprimir un cartel había que sacar las hojas del
 * pedido de la impresora, o al revés.
 */
export function PrintButton({ hayCarteles = true }: { hayCarteles?: boolean }) {
  return (
    <>
      <button className="btn primary no-print" onClick={() => imprimirParte("pedido")}>
        {IconPrint} Imprimir pedido
      </button>
      {/* Si este pedido no lleva ningún cartel, el botón no tiene qué imprimir. */}
      {hayCarteles && (
        <button className="btn ghost no-print" onClick={() => imprimirParte("carteles")}>
          {IconCartel} Imprimir cartelitos
        </button>
      )}
    </>
  );
}

/** Para la pantalla del resumen del depósito, que imprime una sola cosa. */
export function PrintPlainButton({ label = "Imprimir" }: { label?: string }) {
  return (
    <button className="btn primary no-print" onClick={() => window.print()}>
      {IconPrint} {label}
    </button>
  );
}
