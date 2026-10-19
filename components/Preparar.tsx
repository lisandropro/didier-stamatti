"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { destildarItem, tildarItem, tildarSectorEntero } from "@/app/actions/preparacion";
import { intentar } from "@/lib/actualizacion";
import { seccionesDePantalla, type EstadoItem } from "@/lib/preparacion";

type Item = {
  clave: string;
  itemName: string;
  unit: string;
  category: string;
  qty: number;
  note: string | null;
  estado: EstadoItem;
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

const unidad = (u: string) => (u === "Unidad" ? "" : ` ${u.toLowerCase()}`);

/** Cuánto dura el error en pantalla. Sin esto se queda hasta el próximo toque. */
const ERROR_MS = 8_000;

/** Lo que se le pregunta a quien toca una fila de "Cambios para aplicar": la
 *  acción en palabras, para que no confirme sin haberla hecho. */
function preguntaDeAplicacion(i: Item): string {
  if (i.estado === "SACAR") return "¿Ya lo sacaste?";
  if (i.estado === "NOTA") return "¿Ya viste la nota nueva?";
  const dif = i.qty - (i.tildadoQty ?? 0);
  return dif > 0 ? `¿Ya sumaste ${dif}${unidad(i.unit)}?` : `¿Ya sacaste ${-dif}${unidad(i.unit)}?`;
}

/**
 * La preparación de un evento, para el teléfono del depósito.
 *
 * Reemplaza al papel: arriba lo que cambió después de preparar (lo único que
 * obliga a moverse), después cada sector con su avance, y al final lo que falta
 * en el período. Toda la fila se toca para tildar; la nota se ve siempre.
 */
export function Preparar({ data }: { data: Data }) {
  const router = useRouter();
  // Cada fila se bloquea solo mientras se guarda ella: un tilde lento no puede
  // tragarse los toques sobre las demás.
  const [enVuelo, setEnVuelo] = useState<ReadonlySet<string>>(() => new Set());
  // Un objeto y no un texto: dos errores iguales seguidos reinician el reloj.
  const [error, setError] = useState<{ texto: string } | null>(null);
  const [sectorAConfirmar, setSectorAConfirmar] = useState<string | null>(null);
  // La fila de "Cambios para aplicar" que espera la confirmación. Una sola a la vez.
  const [armada, setArmada] = useState<string | null>(null);

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

  // El error se va solo: quien está mirando otra parte de la lista no lo va a
  // cerrar, y uno viejo en pantalla hace dudar de si lo último se guardó.
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), ERROR_MS);
    return () => clearTimeout(id);
  }, [error]);

  async function correr<T extends { ok: boolean; error?: string }>(clave: string, accion: () => Promise<T>) {
    setEnVuelo((prev) => new Set(prev).add(clave));
    const r = await intentar(accion);
    setEnVuelo((prev) => {
      const sig = new Set(prev);
      sig.delete(clave);
      return sig;
    });
    if (r.ok) {
      setError(null);
      return;
    }
    setError({ texto: r.error ?? "No se pudo guardar." });
    // Si falló, la pantalla quedó vieja (el ítem ya no está, el evento se fue):
    // se vuelve a pedir para que la lista se ponga al día.
    router.refresh();
  }

  function alternar(i: Item) {
    if (!data.puedeTildar || enVuelo.has(i.clave)) return;
    // Tocar algo preparado lo destilda (errores de quien tilda). Tocar algo
    // pendiente, que cambió o hay que sacar, lo da por hecho con el pedido de ahora.
    void correr(i.clave, () =>
      i.estado === "PREPARADO" ? destildarItem(data.evento.id, i.clave) : tildarItem(data.evento.id, i.clave),
    );
  }

  /** Lo pendiente y lo preparado se resuelve con un toque: tildar y destildar no
   *  pierden nada. Lo de "Cambios para aplicar" no: un toque suelto lo daría por
   *  hecho sin que nadie mueva nada, y esa instrucción se perdería. Ahí el primer
   *  toque solo abre la pregunta (y un segundo toque la cierra). */
  function tocar(i: Item, pideConfirmar: boolean) {
    if (!data.puedeTildar || enVuelo.has(i.clave)) return;
    if (pideConfirmar) {
      setArmada((actual) => (actual === i.clave ? null : i.clave));
      return;
    }
    alternar(i);
  }

  function confirmar(i: Item) {
    setArmada(null);
    alternar(i);
  }

  function tildarSector(category: string) {
    setSectorAConfirmar(null);
    void correr(`sector:${category}`, () => tildarSectorEntero(data.evento.id, category));
  }

  const { paraAplicar, sectores } = seccionesDePantalla(data.items);

  // Si el pedido se actualizó y la fila armada ya no está en "Cambios para
  // aplicar" (otro teléfono la tildó), se desarma: si volviera a cambiar,
  // no puede reaparecer con una pregunta abierta que nadie hizo.
  if (armada !== null && !paraAplicar.some((i) => i.clave === armada)) setArmada(null);

  const fila = (i: Item, pideConfirmar: boolean) => (
    <Fila
      key={i.clave}
      item={i}
      puedeTildar={data.puedeTildar}
      ocupada={enVuelo.has(i.clave)}
      pideConfirmar={pideConfirmar}
      armada={armada === i.clave}
      alTocar={() => tocar(i, pideConfirmar)}
      alConfirmar={() => confirmar(i)}
      alCancelar={() => setArmada(null)}
    />
  );

  return (
    <>
      {/* El error vive en la cabecera fija: si estuviera al principio de la
          lista, quien está scrolleado más abajo tocaría sin ver que no se guardó. */}
      <div className="prep-cabecera">
        <div className="prep-cabecera-fila">
          <Link href="/preparar" className="prep-volver" aria-label="Volver a Preparar">←</Link>
          {/* Una sola línea: en el teléfono la cabecera fija no puede comerse la
              pantalla. Si el lugar es largo, lo que se corta es el lugar. */}
          <div className="prep-titulo">
            <b>{data.evento.lugar}</b>
            <span className="prep-cuando">
              · {data.evento.esHoy ? <span className="prep-hoy">HOY</span> : null} {data.evento.cuando}
            </span>
          </div>
          {data.faltantes.length > 0 && (
            <a href="#faltantes" className="prep-faltan">Faltan {data.faltantes.length}</a>
          )}
        </div>
        {error && <div className="form-error prep-error" role="alert">{error.texto}</div>}
      </div>

      <div className="content prep-contenido">
        {!data.puedeTildar && (
          <p className="prep-solo-lectura">Solo lectura: tildan el depósito, logística y la administradora.</p>
        )}

        {paraAplicar.length > 0 && (
          <section className="prep-seccion prep-aplicar">
            <h2>Cambios para aplicar <span className="count-pill">{paraAplicar.length}</span></h2>
            {paraAplicar.map((i) => fila(i, true))}
          </section>
        )}

        {sectores.map((s) => (
          <section key={s.category} className="prep-seccion">
            {/* El botón fuera del h2: si no, el nombre del título leído por un
                lector de pantalla sería "Enseres 1/5 Tildar todo". */}
            <div className="prep-seccion-cab">
              <h2>
                {s.label} <span className={`count-pill${s.listos === s.total ? " ok" : ""}`}>{s.listos}/{s.total}</span>
              </h2>
              {data.puedeTildar && s.pendientes > 0 && (
                <button
                  type="button"
                  className="btn ghost prep-sector-btn"
                  onClick={() => setSectorAConfirmar(s.category)}
                  disabled={enVuelo.has(`sector:${s.category}`)}
                  aria-label={`Tildar todo ${s.label}`}
                >
                  Tildar todo
                </button>
              )}
            </div>
            {s.filas.map((i) => fila(i, false))}
            {s.filas.length === 0 && <p className="prep-nada">Lo de este sector está arriba, en &quot;Cambios para aplicar&quot;.</p>}
          </section>
        ))}

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
                  <b>{f.name}</b> · piden {f.pedido}{unidad(f.unit)} · hay {f.hay}{unidad(f.unit)} · <span className="prep-falta">faltan {f.faltan}{unidad(f.unit)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {sectorAConfirmar && (
        <div className="overlay" onClick={() => setSectorAConfirmar(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prep-sector-titulo"
            onKeyDown={(e) => { if (e.key === "Escape") setSectorAConfirmar(null); }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="prep-sector-titulo">¿Tildar todo {sectores.find((s) => s.category === sectorAConfirmar)?.label ?? sectorAConfirmar}?</h2>
            <div className="msub">
              Se tilda solo lo pendiente. Lo que cambió o hay que sacar se confirma de a uno, porque hay que mover algo.
            </div>
            <div className="modal-actions">
              {/* El foco arranca en Cancelar: así Escape llega al diálogo y un Enter de más no tilda nada. */}
              <button type="button" className="btn ghost" onClick={() => setSectorAConfirmar(null)} autoFocus>Cancelar</button>
              <button type="button" className="btn primary" onClick={() => tildarSector(sectorAConfirmar)}>Tildar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Fila({
  item: i,
  puedeTildar,
  ocupada,
  pideConfirmar,
  armada,
  alTocar,
  alConfirmar,
  alCancelar,
}: {
  item: Item;
  puedeTildar: boolean;
  ocupada: boolean;
  pideConfirmar: boolean;
  armada: boolean;
  alTocar: () => void;
  alConfirmar: () => void;
  alCancelar: () => void;
}) {
  const hecho = i.estado === "PREPARADO";
  const cantidad = i.estado === "SACAR" ? 0 : i.qty;
  // La confirmación es hermana de la fila y no hija: una fila que es un <button>
  // no puede contener otros botones.
  return (
    <div className="prep-fila-caja">
      <button
        type="button"
        className={`prep-fila estado-${i.estado.toLowerCase()}${ocupada ? " ocupada" : ""}${armada ? " armada" : ""}`}
        onClick={alTocar}
        disabled={!puedeTildar || ocupada}
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
          {i.note && <span className="prep-nota"><span aria-hidden="true">✎</span> {i.note}</span>}
          {i.estado === "NOTA" && i.tildadoNota && <span className="prep-nota vieja">antes: {i.tildadoNota}</span>}
          {i.tildadoPor && hecho && <span className="prep-por">{i.tildadoPor}</span>}
        </span>
        <span className="prep-cantidad">
          {cantidad}
          <small>{unidad(i.unit)}</small>
        </span>
      </button>
      {pideConfirmar && armada && (
        <div className="prep-confirma" role="group" aria-label={`Confirmar ${i.itemName}`}>
          <span className="prep-confirma-texto">{preguntaDeAplicacion(i)}</span>
          <button type="button" className="btn primary" onClick={alConfirmar}>Sí, listo</button>
          <button type="button" className="btn ghost" onClick={alCancelar}>Todavía no</button>
        </div>
      )}
    </div>
  );
}
