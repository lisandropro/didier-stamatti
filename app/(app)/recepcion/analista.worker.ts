/// <reference lib="webworker" />
import jsQR from "jsqr";
import { detectarCuadrilatero } from "@/lib/comprobantes/cuadrilatero";

// El hilo donde se hace el trabajo pesado del visor.
//
// **Por qué existe.** Medido sobre cuadros reales a resolución de video, con la
// estimación de un teléfono siendo unas cuatro veces más lento que esta máquina:
//
//     lector de QR (jsQR) a 1000 px   ~660 ms por pasada
//     detección del papel a 200 px     ~67 ms por pasada
//
// Los dos corrían en el hilo principal, y el de QR además sin ningún freno —una
// pasada atrás de otra por `requestAnimationFrame`—. Con el hilo bloqueado más
// de medio segundo por vez, el video no puede ir fluido de ninguna manera: no
// importa cuánto se optimice el dibujo del marco si nada puede dibujarse.
//
// Acá el hilo principal solo copia el cuadro a un lienzo chico y manda los
// píxeles. Eso son un par de milisegundos; el resto sucede donde no molesta.
//
// **El buffer se transfiere, no se copia.** `postMessage` con una lista de
// transferibles mueve la memoria en vez de duplicarla: copiar un cuadro por
// lectura, diez veces por segundo, es basura que después hay que juntar.

export type PedidoAlAnalista =
  | { tipo: "papel"; id: number; datos: ArrayBuffer; ancho: number; alto: number }
  | { tipo: "qr"; id: number; datos: ArrayBuffer; ancho: number; alto: number };

export type RespuestaDelAnalista =
  | { tipo: "papel"; id: number; esquinas: { x: number; y: number }[] | null }
  | { tipo: "qr"; id: number; valor: string | null };

self.onmessage = (e: MessageEvent<PedidoAlAnalista>) => {
  const p = e.data;
  const datos = new Uint8ClampedArray(p.datos);

  if (p.tipo === "papel") {
    let esquinas: { x: number; y: number }[] | null = null;
    try {
      esquinas = detectarCuadrilatero(datos, p.ancho, p.alto)?.esquinas ?? null;
    } catch {
      // Un cuadro que no se pudo analizar no es un error: viene el siguiente.
    }
    const r: RespuestaDelAnalista = { tipo: "papel", id: p.id, esquinas };
    self.postMessage(r);
    return;
  }

  let valor: string | null = null;
  try {
    // `dontInvert`: probar también el negativo duplica el costo y un QR de
    // factura está impreso en negro sobre blanco.
    valor = jsQR(datos, p.ancho, p.alto, { inversionAttempts: "dontInvert" })?.data ?? null;
  } catch {
    /* idem */
  }
  const r: RespuestaDelAnalista = { tipo: "qr", id: p.id, valor };
  self.postMessage(r);
};
