import Link from "next/link";
import type { Hallazgo } from "@/lib/checks";
import { IconWarn } from "@/components/iconos";

/**
 * Los controles de datos, en Avisos.
 *
 * Viven acá y no en la pantalla de períodos por dos motivos: Avisos es donde ya
 * se mira lo que necesita atención, y la de períodos es la pantalla de trabajo
 * de todo el equipo — llenarla de pendientes que no le tocan a quien está
 * armando un pedido la vuelve ruido.
 *
 * Solo señalan: cada línea lleva al lugar donde la persona decide qué hacer.
 */
export function ParaRevisar({ hallazgos }: { hallazgos: Hallazgo[] }) {
  if (hallazgos.length === 0) return null;
  return (
    <section className="revision" aria-labelledby="para-revisar">
      <div className="revision-head">
        {IconWarn}
        <h2 id="para-revisar">Para revisar</h2>
        <span className="count-pill">{hallazgos.length}</span>
      </div>
      <ul className="revision-list">
        {hallazgos.map((h, i) => (
          <li key={h.code + i} className={`revision-item grav-${h.gravedad}`}>
            {h.url ? (
              <Link href={h.url}>
                <span className="revision-texto">{h.message}</span>
              </Link>
            ) : (
              <span>{h.message}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
