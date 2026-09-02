"use client";

import { useEffect, useRef, useState } from "react";
import { proponerEsquinas, marcoPorDefecto, type Esquina } from "@/lib/comprobantes/escaneo";

// El paso entre sacar la foto y guardarla: marcar dónde está el papel.
//
// **Las esquinas se arrastran, y eso no es un extra.** La detección automática
// falla seguido con carpetas de anillos y mesas oscuras; sin poder corregirla, un
// recorte mal hecho es peor que la foto cruda, porque se come un borde y se
// lleva puesto el CAE. Con el arrastre, el peor caso son cuatro toques.
//
// El marco arranca donde el detector dice, y si no dice nada, en un rectángulo
// generoso. Nunca arranca en las esquinas de la foto: desde ahí hay que
// arrastrar las cuatro sí o sí.

/** El radio del área que responde al dedo. 22 px de radio son 44 de diámetro,
 *  que es la medida mínima de algo que se toca con el pulgar. */
const RADIO_TOQUE = 22;

export default function Recorte({
  fuente,
  onCambio,
}: {
  fuente: HTMLCanvasElement;
  /** Se llama con las esquinas en coordenadas de la foto original. */
  onCambio: (esquinas: Esquina[]) => void;
}) {
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const [esquinas, setEsquinas] = useState<Esquina[]>(() => {
    return proponerEsquinas(fuente) ?? marcoPorDefecto(fuente.width, fuente.height);
  });
  const [arrastrando, setArrastrando] = useState<number | null>(null);
  const [autodetectado] = useState(() => proponerEsquinas(fuente) !== null);

  // El lienzo se dibuja al tamaño que ocupa en pantalla, no al de la foto: una
  // foto de 12 megapíxeles dibujada entera en un teléfono es lenta y no se ve
  // mejor.
  useEffect(() => {
    const lienzo = lienzoRef.current;
    if (!lienzo) return;
    const ctx = lienzo.getContext("2d");
    if (!ctx) return;

    const escala = lienzo.width / fuente.width;
    ctx.clearRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);

    // Lo de afuera del marco se oscurece: es la forma más directa de decir "esto
    // se va a recortar" sin una sola palabra.
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.rect(0, 0, lienzo.width, lienzo.height);
    esquinas.forEach((p, i) => {
      const m = i === 0 ? "moveTo" : "lineTo";
      ctx[m](p.x * escala, p.y * escala);
    });
    ctx.closePath();
    ctx.fill("evenodd");

    ctx.strokeStyle = "#A8813E";
    ctx.lineWidth = 2;
    ctx.beginPath();
    esquinas.forEach((p, i) => {
      const m = i === 0 ? "moveTo" : "lineTo";
      ctx[m](p.x * escala, p.y * escala);
    });
    ctx.closePath();
    ctx.stroke();

    esquinas.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x * escala, p.y * escala, arrastrando === i ? 14 : 10, 0, Math.PI * 2);
      ctx.fillStyle = "#A8813E";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    });
  }, [esquinas, fuente, arrastrando]);

  useEffect(() => {
    onCambio(esquinas);
  }, [esquinas, onCambio]);

  /** De un toque en pantalla a coordenadas de la foto original. */
  function aFoto(e: React.PointerEvent): Esquina {
    const lienzo = lienzoRef.current!;
    const caja = lienzo.getBoundingClientRect();
    const escala = fuente.width / caja.width;
    return { x: (e.clientX - caja.left) * escala, y: (e.clientY - caja.top) * escala };
  }

  function empezar(e: React.PointerEvent) {
    const p = aFoto(e);
    const caja = lienzoRef.current!.getBoundingClientRect();
    // El umbral se mide en píxeles de PANTALLA y se convierte: en una foto de
    // 12 megapíxeles, un radio fijo en píxeles de imagen sería microscópico.
    const umbral = RADIO_TOQUE * (fuente.width / caja.width);

    let masCerca = -1;
    let mejor = Infinity;
    esquinas.forEach((q, i) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < mejor) {
        mejor = d;
        masCerca = i;
      }
    });
    if (mejor > umbral) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    setArrastrando(masCerca);
  }

  function mover(e: React.PointerEvent) {
    if (arrastrando === null) return;
    e.preventDefault();
    const p = aFoto(e);
    // Se puede arrastrar hasta el borde de la foto, no más allá: una esquina
    // fuera de la imagen daría un recorte con una franja en blanco.
    const x = Math.max(0, Math.min(fuente.width, p.x));
    const y = Math.max(0, Math.min(fuente.height, p.y));
    setEsquinas((prev) => prev.map((q, i) => (i === arrastrando ? { x, y } : q)));
  }

  function soltar() {
    setArrastrando(null);
  }

  // El lienzo se dimensiona para llenar el ancho disponible manteniendo la
  // proporción de la foto.
  const proporcion = fuente.height / fuente.width;
  const anchoLienzo = 720;

  return (
    <div className="rec-caja">
      <canvas
        ref={lienzoRef}
        width={anchoLienzo}
        height={Math.round(anchoLienzo * proporcion)}
        className="rec-lienzo"
        onPointerDown={empezar}
        onPointerMove={mover}
        onPointerUp={soltar}
        onPointerCancel={soltar}
      />
      <p className="rec-ayuda">
        {autodetectado
          ? "Arrastrá los puntos si el recorte no agarra bien el papel."
          : "No se encontró el borde del papel. Arrastrá los cuatro puntos hasta las esquinas."}
      </p>
    </div>
  );
}
