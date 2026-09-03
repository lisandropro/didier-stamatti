"use client";

import { useEffect, useRef } from "react";
import type { Esquina } from "@/lib/comprobantes/escaneo";
import { SeguidorDePapel, ocupaPoco, type Cuadro } from "@/lib/comprobantes/seguidor";
import type { PedidoAlAnalista, RespuestaDelAnalista } from "./analista.worker";

// El visor: detecta el papel, lee el QR y dibuja el marco.
//
// Es lo que hace que se sienta como un escáner en vez de como una cámara: cuando
// disparás, el recorte **ya está decidido**, así que no hace falta una pantalla
// de ajuste después.
//
// **Todo el trabajo pesado vive en un worker.** Medido sobre cuadros reales a
// resolución de video, con un teléfono siendo unas cuatro veces más lento que la
// máquina de desarrollo:
//
//     lector de QR (jsQR) a 1000 px   ~660 ms por pasada
//     detección del papel a 200 px     ~67 ms por pasada
//
// Los dos corrían en el hilo principal, y el de QR además **sin ningún freno**:
// una pasada atrás de otra por `requestAnimationFrame`. Con el hilo bloqueado
// más de medio segundo por vez, el video no podía ir fluido por más que se
// optimizara el dibujo — no había hueco donde dibujar.
//
// Acá el hilo principal hace tres cosas baratas: copiar el cuadro a un lienzo
// chico, mandar los píxeles, y pintar cuatro líneas. Todo lo demás sucede al
// lado.

/** Ancho al que se analiza el papel. Medido: 200 px acierta igual que 240 y
 *  cuesta menos; la resolución extra no compra aciertos. */
const ANCHO_PAPEL = 200;

/** Ancho al que se busca el QR. Más chico pierde códigos; más grande ya no
 *  compra nada, porque el cuello de botella dejó de ser el hilo principal. */
const ANCHO_QR = 800;

/** Cada cuánto se pide una lectura del papel. */
const MS_PAPEL = 90;

/** Cada cuánto se busca un QR. Mucho más espaciado: un código no aparece y
 *  desaparece en cien milisegundos, y cada pasada es cara aunque no bloquee. */
const MS_QR = 350;

/**
 * Cuánto se acerca el marco dibujado a su objetivo en cada cuadro.
 *
 * Esto es lo que lo hace deslizar. El seguidor suaviza **entre lecturas** —unas
 * once por segundo—; esto suaviza **entre cuadros**, sesenta por segundo. Sin
 * esta segunda capa el marco avanza a saltos de once por segundo y se ve
 * entrecortado aunque el video vaya perfecto.
 */
const ACERCAMIENTO_POR_CUADRO = 0.25;

/**
 * Tope de resolución del lienzo del marco.
 *
 * Antes se dimensionaba al video —hasta 1920×1080— y se borraba y repintaba
 * sesenta veces por segundo. Eso es trabajo de GPU y de memoria por un dibujo de
 * cuatro líneas. A 720 de ancho se ve idéntico en cualquier teléfono.
 */
const ANCHO_MARCO = 720;

const VERDE = "#22c07a";

export type EstadoDeteccion = {
  /** Las cuatro esquinas en coordenadas del VIDEO, o `null` si no hay papel. */
  cuadro: Cuadro | null;
  /** El papel está lejos: la foto va a salir con el texto chico. */
  lejos: boolean;
};

export function useDeteccionViva(
  video: React.RefObject<HTMLVideoElement | null>,
  lienzo: React.RefObject<HTMLCanvasElement | null>,
  activo: boolean,
  alCambiar: (e: EstadoDeteccion) => void,
  alLeerQr: (valor: string) => void,
): React.RefObject<EstadoDeteccion> {
  // Los callbacks viven en refs para que cambiarlos no reinicie el visor: sin
  // esto, cada render volvería a arrancar el bucle y el marco parpadearía.
  //
  // La asignación va en un efecto y no en el cuerpo: escribir una ref durante el
  // render es lo que React 19 marca, y con razón — en modo concurrente un render
  // puede descartarse, y la escritura quedaría hecha igual.
  const cb = useRef(alCambiar);
  const cbQr = useRef(alLeerQr);
  useEffect(() => {
    cb.current = alCambiar;
    cbQr.current = alLeerQr;
  });

  const ultimaLectura = useRef<EstadoDeteccion>({ cuadro: null, lejos: false });

  useEffect(() => {
    if (!activo) return;

    const worker = new Worker(new URL("./analista.worker.ts", import.meta.url));
    const seguidor = new SeguidorDePapel();

    // Un lienzo por tarea, reusados: crear uno por lectura llena la memoria del
    // teléfono en segundos.
    const paraPapel = document.createElement("canvas");
    const ctxPapel = paraPapel.getContext("2d", { willReadFrequently: true });
    const paraQr = document.createElement("canvas");
    const ctxQr = paraQr.getContext("2d", { willReadFrequently: true });

    let vivo = true;
    let rafId = 0;
    let ultimoPapel = 0;
    let ultimoQr = 0;
    // Sin esto se acumularían pedidos más rápido de lo que el worker responde y
    // la cola crecería para siempre.
    let papelEnVuelo = false;
    let qrEnVuelo = false;
    let siguienteId = 1;

    /** Dónde tiene que estar el marco, según la última lectura. */
    let objetivo: Cuadro | null = null;
    /** Dónde está dibujado ahora. Persigue al objetivo cuadro a cuadro. */
    let dibujado: Cuadro | null = null;

    worker.onmessage = (e: MessageEvent<RespuestaDelAnalista>) => {
      const r = e.data;
      if (r.tipo === "qr") {
        qrEnVuelo = false;
        if (r.valor) cbQr.current(r.valor);
        return;
      }

      papelEnVuelo = false;
      const v = video.current;
      if (!v || !v.videoWidth) return;

      const escala = ANCHO_PAPEL / v.videoWidth;
      const lectura = r.esquinas
        ? (r.esquinas.map((p) => ({ x: p.x / escala, y: p.y / escala })) as Cuadro)
        : null;

      objetivo = seguidor.observar(lectura);
      if (!dibujado && objetivo) dibujado = objetivo;

      const estado: EstadoDeteccion = {
        // Para el disparo vale dónde está el papel de verdad, no dónde llegó a
        // dibujarse el marco.
        cuadro: objetivo,
        lejos: objetivo ? ocupaPoco(objetivo, v.videoWidth, v.videoHeight) : false,
      };
      ultimaLectura.current = estado;
      cb.current(estado);
    };

    function pedir(
      tipo: "papel" | "qr",
      ctx: CanvasRenderingContext2D,
      lienzoAux: HTMLCanvasElement,
      anchoDestino: number,
      v: HTMLVideoElement,
    ) {
      const escala = anchoDestino / v.videoWidth;
      lienzoAux.width = anchoDestino;
      lienzoAux.height = Math.max(8, Math.round(v.videoHeight * escala));
      ctx.drawImage(v, 0, 0, lienzoAux.width, lienzoAux.height);
      const img = ctx.getImageData(0, 0, lienzoAux.width, lienzoAux.height);

      const pedido: PedidoAlAnalista = {
        tipo,
        id: siguienteId++,
        datos: img.data.buffer as ArrayBuffer,
        ancho: img.width,
        alto: img.height,
      };
      // El buffer se TRANSFIERE, no se copia: duplicar un cuadro por lectura,
      // diez veces por segundo, es basura que después hay que juntar.
      worker.postMessage(pedido, [pedido.datos]);
    }

    function pintar(escalaMarco: number) {
      const l = lienzo.current;
      if (!l) return;
      const ctx = l.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, l.width, l.height);
      if (!dibujado) return;

      ctx.beginPath();
      dibujado.forEach((p, i) => {
        const x = p.x * escalaMarco;
        const y = p.y * escalaMarco;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(34,192,122,0.22)";
      ctx.fill();
      ctx.strokeStyle = VERDE;
      ctx.lineWidth = Math.max(2, l.width / 200);
      ctx.stroke();
    }

    function cuadro(ahora: number) {
      if (!vivo) return;
      rafId = requestAnimationFrame(cuadro);

      const v = video.current;
      const l = lienzo.current;
      if (!v || !l || v.readyState < 2 || !v.videoWidth) return;

      // El lienzo se dimensiona una sola vez por cambio: asignar width/height lo
      // borra, así que hacerlo por cuadro produce un parpadeo.
      const escalaMarco = Math.min(1, ANCHO_MARCO / v.videoWidth);
      const w = Math.round(v.videoWidth * escalaMarco);
      const h = Math.round(v.videoHeight * escalaMarco);
      if (l.width !== w || l.height !== h) {
        l.width = w;
        l.height = h;
      }

      // El marco persigue a su objetivo en CADA cuadro. Es lo que lo hace
      // deslizar en vez de avanzar a saltos de once por segundo.
      if (objetivo) {
        const meta = objetivo;
        dibujado = dibujado
          ? (dibujado.map((p, i) => ({
              x: p.x + (meta[i].x - p.x) * ACERCAMIENTO_POR_CUADRO,
              y: p.y + (meta[i].y - p.y) * ACERCAMIENTO_POR_CUADRO,
            })) as Cuadro)
          : meta;
      } else {
        dibujado = null;
      }
      pintar(escalaMarco);

      if (!papelEnVuelo && ahora - ultimoPapel >= MS_PAPEL && ctxPapel) {
        ultimoPapel = ahora;
        papelEnVuelo = true;
        pedir("papel", ctxPapel, paraPapel, ANCHO_PAPEL, v);
      }
      if (!qrEnVuelo && ahora - ultimoQr >= MS_QR && ctxQr) {
        ultimoQr = ahora;
        qrEnVuelo = true;
        pedir("qr", ctxQr, paraQr, ANCHO_QR, v);
      }
    }

    rafId = requestAnimationFrame(cuadro);
    return () => {
      vivo = false;
      cancelAnimationFrame(rafId);
      worker.terminate();
    };
  }, [activo, video, lienzo]);

  return ultimaLectura;
}

/** Las esquinas detectadas, llevadas a las coordenadas de una foto de otro
 *  tamaño. El video y la foto que se dispara no miden lo mismo. */
export function aEscalaDeFoto(c: Cuadro, anchoVideo: number, anchoFoto: number): Esquina[] {
  const k = anchoFoto / anchoVideo;
  return c.map((p) => ({ x: p.x * k, y: p.y * k }));
}
