"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { destildarItem, tildarItem, tildarSectorEntero } from "@/app/actions/preparacion";
import { intentar } from "@/lib/actualizacion";
import { CATEGORIES, nombreDeCategoria } from "@/lib/categories";

type Estado = "PENDIENTE" | "PREPARADO" | "CAMBIO" | "NOTA" | "SACAR";
type Item = {
  clave: string;
  itemName: string;
  unit: string;
  category: string;
  qty: number;
  note: string | null;
  estado: Estado;
  accion: string | null;
  tildadoQty: number | null;
  tildadoNota: string | null;
  tildadoPor: string | null;
};
type Data = {
  evento: { id: string; lugar: string; cuando: string; esHoy: boolean; periodo: string };
  items: Item[];
  faltantes: { id: string; name: string; unit: string; pedido: number; hay: number; faltan: number }[];
  puedeTildar: boolean;
};

const PARA_APLICAR: Estado[] = ["CAMBIO", "NOTA", "SACAR"];
const unidad = (u: string) => (u === "Unidad" ? "" : ` ${u.toLowerCase()}`);

/**
 * La preparación de un evento, para el teléfono del depósito.
 *
 * Reemplaza al papel: arriba lo que cambió después de preparar (lo único que
 * obliga a moverse), después cada sector con su avance, y al final lo que falta
 * en el período. Toda la fila se toca para tildar; la nota se ve siempre.
 */
export function Preparar({ data }: { data: Data }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sectorAConfirmar, setSectorAConfirmar] = useState<string | null>(null);

  // Se actualiza sola: quien prepara con la pantalla abierta tiene que ver
  // llegar un cambio sin recargar. Cada 45 s y al volver a la app.
  useEffect(() => {
    const refrescar = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(refrescar, 45_000);
    document.addEventListener("visibilitychange", refrescar);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refrescar);
    };
  }, [router]);

  async function alternar(i: Item) {
    if (!data.puedeTildar || ocupado) return;
    setOcupado(i.clave);
    setError(null);
    // Tocar algo preparado lo destilda (errores de quien tilda). Tocar algo
    // pendiente, que cambió o hay que sacar, lo da por hecho con el pedido de ahora.
    const r = await intentar(() =>
      i.estado === "PREPARADO" ? destildarItem(data.evento.id, i.clave) : tildarItem(data.evento.id, i.clave),
    );
    setOcupado(null);
    if (!r.ok) {
      setError(r.error ?? "No se pudo guardar.");
      // Si falló, la pantalla quedó vieja (el ítem ya no está, el evento se fue):
      // se vuelve a pedir para que la lista se ponga al día.
      router.refresh();
    }
  }

  async function tildarSector(category: string) {
    setSectorAConfirmar(null);
    setOcupado(`sector:${category}`);
    setError(null);
    const r = await intentar(() => tildarSectorEntero(data.evento.id, category));
    setOcupado(null);
    if (!r.ok) {
      setError(r.error ?? "No se pudo guardar.");
      router.refresh();
    }
  }

  const paraAplicar = data.items.filter((i) => PARA_APLICAR.includes(i.estado));
  const sectores = CATEGORIES.map((c) => ({ category: c, items: data.items.filter((i) => i.category === c) })).filter(
    (s) => s.items.length > 0,
  );

  return (
    <>
      <div className="prep-cabecera">
        <Link href="/preparar" className="prep-volver" aria-label="Volver a Preparar">←</Link>
        {/* Una sola línea: en el teléfono la cabecera fija no puede comerse la pantalla. */}
        <div className="prep-titulo">
          <b>{data.evento.lugar}</b> · {data.evento.esHoy ? <span className="prep-hoy">HOY</span> : null} {data.evento.cuando}
        </div>
        {data.faltantes.length > 0 && (
          <a href="#faltantes" className="prep-faltan">Faltan {data.faltantes.length}</a>
        )}
      </div>

      <div className="content prep-contenido">
        {error && <div className="form-error">{error}</div>}

        {paraAplicar.length > 0 && (
          <section className="prep-seccion prep-aplicar">
            <h2>Cambios para aplicar <span className="count-pill">{paraAplicar.length}</span></h2>
            {paraAplicar.map((i) => (
              <Fila key={i.clave} item={i} puedeTildar={data.puedeTildar} ocupado={ocupado === i.clave} alTocar={() => alternar(i)} />
            ))}
          </section>
        )}

        {sectores.map(({ category, items }) => {
          // El avance cuenta todo (spec: preparados / pedidos + a sacar), pero lo
          // que está arriba en "Cambios para aplicar" no se repite acá: dos filas
          // del mismo ítem hacen dudar de si se tildó dos veces.
          const total = items.length;
          const listos = items.filter((i) => i.estado === "PREPARADO").length;
          const pendientes = items.filter((i) => i.estado === "PENDIENTE").length;
          const filas = items.filter((i) => !PARA_APLICAR.includes(i.estado));
          return (
            <section key={category} className="prep-seccion">
              <h2>
                {nombreDeCategoria(category)} <span className={`count-pill${listos === total ? " ok" : ""}`}>{listos}/{total}</span>
                {data.puedeTildar && pendientes > 0 && (
                  <button className="btn ghost prep-sector-btn" onClick={() => setSectorAConfirmar(category)} disabled={!!ocupado}>
                    Tildar todo
                  </button>
                )}
              </h2>
              {filas.map((i) => (
                <Fila key={i.clave} item={i} puedeTildar={data.puedeTildar} ocupado={ocupado === i.clave} alTocar={() => alternar(i)} />
              ))}
              {filas.length === 0 && <p className="prep-nada">Lo de este sector está arriba, en &quot;Cambios para aplicar&quot;.</p>}
            </section>
          );
        })}

        {data.items.length === 0 && (
          <div className="empty-card">
            <p className="empty-title">Este evento todavía no tiene pedido</p>
          </div>
        )}

        <section id="faltantes" className="prep-seccion">
          <h2>Faltantes del período · {data.evento.periodo}</h2>
          {data.faltantes.length === 0 ? (
            <p className="prep-nada">Todo alcanza en este período.</p>
          ) : (
            <ul className="prep-faltantes">
              {data.faltantes.map((f) => (
                <li key={f.id}>
                  <b>{f.name}</b> · piden {f.pedido}{unidad(f.unit)} · hay {f.hay} · <span className="prep-falta">faltan {f.faltan}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {sectorAConfirmar && (
        <div className="overlay" onClick={() => setSectorAConfirmar(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>¿Tildar todo {nombreDeCategoria(sectorAConfirmar)}?</h2>
            <div className="msub">
              Se tilda solo lo pendiente. Lo que cambió o hay que sacar se confirma de a uno, porque hay que mover algo.
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setSectorAConfirmar(null)}>Cancelar</button>
              <button className="btn primary" onClick={() => tildarSector(sectorAConfirmar)}>Tildar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Fila({ item: i, puedeTildar, ocupado, alTocar }: { item: Item; puedeTildar: boolean; ocupado: boolean; alTocar: () => void }) {
  const hecho = i.estado === "PREPARADO";
  const cantidad = i.estado === "SACAR" ? 0 : i.qty;
  return (
    <button
      type="button"
      className={`prep-fila estado-${i.estado.toLowerCase()}${ocupado ? " ocupada" : ""}`}
      onClick={alTocar}
      disabled={!puedeTildar || ocupado}
      role="checkbox"
      aria-checked={hecho}
    >
      <span className="prep-check" aria-hidden="true">{hecho ? "✓" : ""}</span>
      <span className="prep-item">
        <span className="prep-nombre">{i.itemName}</span>
        {i.accion && (
          <span className="prep-accion">
            {/* Como en la spec: "Antes 10 → ahora 24 · Sumá 14". */}
            {i.estado === "CAMBIO" && i.tildadoQty !== null ? `Antes ${i.tildadoQty} → ahora ${i.qty} · ` : ""}
            {i.accion}
          </span>
        )}
        {i.note && <span className="prep-nota">✎ {i.note}</span>}
        {i.estado === "NOTA" && i.tildadoNota && <span className="prep-nota vieja">antes: {i.tildadoNota}</span>}
        {i.tildadoPor && hecho && <span className="prep-por">{i.tildadoPor}</span>}
      </span>
      <span className="prep-cantidad">
        {cantidad}
        <small>{unidad(i.unit)}</small>
      </span>
    </button>
  );
}
