"use client";

import { useEffect, useRef } from "react";
import { recuadroDeContenido, type Esquina } from "@/lib/comprobantes/escaneo";
import { SeguidorDePapel, ocupaPoco, type Cuadro } from "@/lib/comprobantes/seguidor";

// Detecta el papel mientras la cámara apunta, y dibuja el marco encima del video.
//
// Es lo que hace que se sienta como un escáner en vez de como una cámara: cuando
// disparás, el recorte **ya está decidido**, así que no hace falta una pantalla
// de ajuste después.
//
// Medido contra las 18 fotos reales del depósito, reducidas a resolución de
// video y con desenfoque de movimiento: **18 de 18 detectadas** a 160 px de
// ancho, a 25 ms por lectura. En un teléfono eso son unas 10 lecturas por
// segundo, de sobra para un marco que sigue la mano.

/** Ancho al que se analiza cada cuadro.
 *
 *  160 px acierta igual que 240 y cuesta la mitad. Se midió: 18/18 a 120, 160,
 *  200 y 240 px — la resolución extra no compra aciertos, compra latencia. */
const ANCHO_DE_ANALISIS = 160;

/** Cada cuánto se mira. No es por cuadro de video: a 30 fps sobraría trabajo
 *  para nada, porque el papel no se mueve tan rápido y el suavizado del seguidor
 *  ya rellena entre lecturas. */
const MS_ENTRE_LECTURAS = 90;

const VERDE = "#22c07a";

export type EstadoDeteccion = {
  /** Las cuatro esquinas en coordenadas del VIDEO, o `null` si no hay papel. */
  cuadro: Cuadro | null;
  /** El papel está lejos: la foto va a salir con el texto chico. */
  lejos: boolean;
};

/**
 * Corre la detección sobre `video` y dibuja el marco en `lienzo`.
 *
 * `alCambiar` recibe el estado en cada lectura, para que la pantalla pueda
 * mostrar el consejo de acercarse y para que el disparo sepa dónde está el
 * papel sin volver a calcularlo.
 */
export function usarDeteccionViva(
  video: React.RefObject<HTMLVideoElement | null>,
  lienzo: React.RefObject<HTMLCanvasElement | null>,
  activo: boolean,
  alCambiar: (e: EstadoDeteccion) => void,
) {
  // El callback vive en una ref para que cambiarlo no reinicie la detección:
  // sin esto, cada render volvería a arrancar el bucle.
  const cb = useRef(alCambiar);
  cb.current = alCambiar;

  useEffect(() => {
    if (!activo) return;

    const seguidor = new SeguidorDePapel();
    // Un solo lienzo de análisis para toda la sesión: crear uno por lectura
    // llena la memoria del teléfono en segundos.
    const chico = document.createElement("canvas");
    const ctxChico = chico.getContext("2d", { willReadFrequently: true });

    let vivo = true;
    let ultima = 0;
    let cuadroPedido = 0;

    function pintar() {
      const v = video.current;
      const l = lienzo.current;
      if (!v || !l) return;

      // El lienzo se dimensiona al video una sola vez por cambio de tamaño:
      // asignar width/height lo borra, así que hacerlo por cuadro parpadea.
      if (l.width !== v.videoWidth || l.height !== v.videoHeight) {
        l.width = v.videoWidth;
        l.height = v.videoHeight;
      }

      const ctx = l.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, l.width, l.height);

      const c = seguidor.actual;
      if (!c) return;

      // Relleno translúcido y borde: el relleno es lo que dice "esto es lo que
      // se va a guardar" sin una palabra, y el borde marca dónde termina.
      ctx.beginPath();
      c.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = "rgba(34,192,122,0.22)";
      ctx.fill();
      ctx.strokeStyle = VERDE;
      // El grosor se escala con el video: 3px sobre 1920 no se ve en la pantalla.
      ctx.lineWidth = Math.max(3, l.width / 260);
      ctx.stroke();
    }

    function mirar(ahora: number) {
      if (!vivo) return;
      cuadroPedido = requestAnimationFrame(mirar);

      const v = video.current;
      if (!v || v.readyState < 2 || !ctxChico) return;
      if (ahora - ultima < MS_ENTRE_LECTURAS) {
        pintar();
        return;
      }
      ultima = ahora;

      const escala = ANCHO_DE_ANALISIS / v.videoWidth;
      chico.width = ANCHO_DE_ANALISIS;
      chico.height = Math.max(8, Math.round(v.videoHeight * escala));
      ctxChico.drawImage(v, 0, 0, chico.width, chico.height);

      let lectura: Cuadro | null = null;
      try {
        const r = recuadroDeContenido(
          ctxChico.getImageData(0, 0, chico.width, chico.height).data,
          chico.width,
          chico.height,
        );
        if (r) {
          // De vuelta a coordenadas del video.
          const a = (n: number) => n / escala;
          lectura = [
            { x: a(r.x0), y: a(r.y0) },
            { x: a(r.x1), y: a(r.y0) },
            { x: a(r.x1), y: a(r.y1) },
            { x: a(r.x0), y: a(r.y1) },
          ];
        }
      } catch {
        // Un cuadro que no se pudo leer no es un error: se prueba el siguiente.
      }

      const cuadro = seguidor.observar(lectura);
      pintar();
      cb.current({
        cuadro,
        lejos: cuadro ? ocupaPoco(cuadro, v.videoWidth, v.videoHeight) : false,
      });
    }

    cuadroPedido = requestAnimationFrame(mirar);
    return () => {
      vivo = false;
      cancelAnimationFrame(cuadroPedido);
    };
  }, [activo, video, lienzo]);
}

/** Las esquinas detectadas, llevadas a las coordenadas de una foto de otro
 *  tamaño. El video y la foto que se dispara no miden lo mismo. */
export function aEscalaDeFoto(c: Cuadro, anchoVideo: number, anchoFoto: number): Esquina[] {
  const k = anchoFoto / anchoVideo;
  return c.map((p) => ({ x: p.x * k, y: p.y * k }));
}
