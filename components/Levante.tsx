"use client";

import Link from "next/link";
import { useEffect, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import {
  descontarItem,
  desmarcarItem,
  marcarFaltaItem,
  marcarSectorEntero,
  marcarVolvioItem,
  reabrirElLevante,
  terminarElLevante,
  type LevanteResult,
} from "@/app/actions/levante";
import { intentar } from "@/lib/actualizacion";
import {
  TEXTO_DE_BAJA,
  esFaltaValida,
  resumenDeLevante,
  seccionesDeLevante,
  type Baja,
  type EstadoLevante,
  type MotivoBaja,
  type ResumenDeLevante,
  type VistoDeLevante,
} from "@/lib/levante";
import { esCategoria } from "@/lib/categories";
import { vibrar, PATRON } from "@/lib/vibrar";
import { RefrescoPeriodico } from "@/components/RefrescoPeriodico";
import { Confirmar, Dialogo } from "@/components/Dialogo";
import { MensajeDeError } from "@/components/Formulario";
import { IconBack } from "@/components/iconos";
import { sinRueda, unidad } from "@/components/util";

type Item = {
  clave: string;
  itemName: string;
  unit: string;
  category: string;
  qty: number;
  note: string | null;
  estado: EstadoLevante;
  faltan: number;
  marcadoPor: string | null;
  /** "Rotura", "Pérdida": ya se descontó del stock. */
  descontado: string | null;
  /** Solo en un faltante sin descontar, para quien puede descontar: si se
   *  puede, y si no, por qué. */
  baja: Baja | null;
  /** Cuántas unidades baja de verdad "Dar de baja": no más que el stock. */
  bajan: number | null;
};
type Data = {
  evento: { id: string; lugar: string; cuando: string; esHoy: boolean };
  items: Item[];
  /** Quién y cuándo lo terminó, o null si sigue abierto. */
  terminado: { por: string } | null;
  puedeMarcar: boolean;
  puedeAjustarStock: boolean;
};

/** Cuánto dura el error en pantalla. Sin esto se queda hasta el próximo toque. */
const ERROR_MS = 8_000;

/** La hoja "¿Cuántos faltan?", con lo que mostraba la fila al abrirla. */
type Hoja = { clave: string; itemName: string; unit: string; qty: number; estado: EstadoLevante; faltanVisto: number; valor: string };
const sigueComoSeAbrio = (h: Hoja, i: Item) =>
  h.clave === i.clave && h.qty === i.qty && h.estado === i.estado && h.faltanVisto === i.faltan;

/** "Volvieron 38", dicho al revés de lo que se elige: es lo que se ve en el salón. */
function textoDeVuelta(h: Hoja): string {
  const n = Number(h.valor);
  if (!esFaltaValida(n, h.qty)) return `De 1 a ${h.qty}`;
  const volvieron = h.qty - n;
  return volvieron === 0 ? "No volvió ninguno" : volvieron === 1 ? "Volvió 1" : `Volvieron ${volvieron}`;
}

/** El cierre en una línea: "2 ítems con faltantes · 1 sin revisar". */
function textoDeCierre(r: ResumenDeLevante): string {
  const partes: string[] = [];
  if (r.faltantes.length > 0) partes.push(r.faltantes.length === 1 ? "1 ítem con faltantes" : `${r.faltantes.length} ítems con faltantes`);
  if (r.sinRevisar > 0) partes.push(`${r.sinRevisar} sin revisar`);
  return partes.length === 0 ? "Volvió todo." : partes.join(" · ");
}

/**
 * El levante de un evento, para el teléfono de quien junta en el salón.
 *
 * La lista es lo que fue al evento, por sector, con lo pendiente arriba. Tocar
 * la fila la tacha (volvió todo); "Falta" pregunta cuántos no volvieron. Al pie,
 * "Terminar levante" le avisa a la administradora.
 */
export function Levante({ data }: { data: Data }) {
  const router = useRouter();
  // Cada fila se bloquea solo mientras se guarda ella: un toque lento no puede
  // tragarse los toques sobre las demás.
  const [enVuelo, setEnVuelo] = useState<ReadonlySet<string>>(() => new Set());
  // Un objeto y no un texto: dos errores iguales seguidos reinician el reloj.
  const [error, setError] = useState<{ texto: string } | null>(null);
  const [hoja, setHoja] = useState<Hoja | null>(null);
  // El sector a tachar entero, con sus filas pendientes tal como se veían al
  // tocar "Tachar todo": lo que entre mientras el diálogo está abierto nadie lo vio.
  const [sectorAConfirmar, setSectorAConfirmar] = useState<{ category: string; vistos: VistoDeLevante[] } | null>(null);
  // Cuántos quedaban sin revisar cuando se preguntó "¿Terminar igual?".
  const [terminarConfirmar, setTerminarConfirmar] = useState<number | null>(null);

  // El error se va solo: quien está mirando otra parte de la lista no lo va a
  // cerrar, y uno viejo en pantalla hace dudar de si lo último se guardó.
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), ERROR_MS);
    return () => clearTimeout(id);
  }, [error]);

  async function correr(clave: string, accion: () => Promise<LevanteResult>): Promise<LevanteResult> {
    setEnVuelo((prev) => new Set(prev).add(clave));
    const r = await intentar(accion);
    setEnVuelo((prev) => {
      const sig = new Set(prev);
      sig.delete(clave);
      return sig;
    });
    if (r.ok && !r.aviso) {
      setError(null);
      return r;
    }
    // Terminar con un número viejo no es un error: quien llama vuelve a preguntar
    // con el de ahora. Un aviso tampoco (lo demás se guardó), pero va en la tira.
    if (r.confirmar === undefined) setError({ texto: (r.ok ? r.aviso : r.error) ?? "No se pudo guardar." });
    // Si falló o hubo aviso, la pantalla quedó vieja: se vuelve a pedir. Sin señal
    // no se pide nada: `router.refresh()` falla y Next 16 hace una navegación
    // completa, que el service worker contesta con la página de "sin conexión", y
    // esa reemplazaría la lista que se está leyendo, justo donde no hay señal. La
    // franja de abajo ya avisa; al volver la señal, `SinConexion` refresca.
    if (navigator.onLine) router.refresh();
    return r;
  }

  function abrirHoja(i: Item) {
    if (!data.puedeMarcar || i.descontado !== null || enVuelo.has(i.clave)) return;
    // Propone todos (lo más común cuando se pierde algo es que no aparezca
    // ninguno), o lo ya marcado si se está corrigiendo.
    setHoja({
      clave: i.clave,
      itemName: i.itemName,
      unit: i.unit,
      qty: i.qty,
      estado: i.estado,
      faltanVisto: i.faltan,
      valor: String(i.estado === "FALTA" ? i.faltan : i.qty),
    });
  }

  /** Tocar la fila: lo pendiente pasa a "volvió todo" y lo que volvió vuelve a
   *  pendiente (errores de quien marca). Un faltante no se resuelve de un toque:
   *  abre la hoja para corregirlo o desmarcarlo. */
  function alternar(i: Item) {
    if (!data.puedeMarcar || i.descontado !== null || enVuelo.has(i.clave)) return;
    if (i.estado === "FALTA") {
      abrirHoja(i);
      return;
    }
    vibrar(i.estado === "VOLVIO" ? PATRON.destildar : PATRON.tildar);
    void correr(i.clave, () =>
      i.estado === "VOLVIO" ? desmarcarItem(data.evento.id, i.clave, 0) : marcarVolvioItem(data.evento.id, i.clave, i.qty),
    );
  }

  function pasoHoja(d: number) {
    // Updater funcional: toques rápidos seguidos se acumulan bien.
    setHoja((h) => {
      if (!h) return h;
      const n = Math.round(Number(h.valor));
      const base = Number.isFinite(n) ? n : h.qty;
      return { ...h, valor: String(Math.min(h.qty, Math.max(1, base + d))) };
    });
  }

  function guardarHoja(h: Hoja) {
    const n = Number(h.valor);
    if (!esFaltaValida(n, h.qty)) return;
    setHoja(null);
    vibrar(PATRON.tildar);
    void correr(h.clave, () => marcarFaltaItem(data.evento.id, h.clave, h.qty, n));
  }

  function desmarcarHoja(h: Hoja) {
    setHoja(null);
    vibrar(PATRON.destildar);
    void correr(h.clave, () => desmarcarItem(data.evento.id, h.clave, h.faltanVisto));
  }

  function tacharSector(a: { category: string; vistos: VistoDeLevante[] }) {
    setSectorAConfirmar(null);
    vibrar(PATRON.tildarSector);
    void correr(`sector:${a.category}`, () => marcarSectorEntero(data.evento.id, a.category, a.vistos));
  }

  async function terminar(sinRevisarVisto: number) {
    setTerminarConfirmar(null);
    const r = await correr("terminar", () => terminarElLevante(data.evento.id, sinRevisarVisto));
    if (r.confirmar === undefined) {
      if (r.ok) vibrar(PATRON.tildarSector);
      return;
    }
    // Otro teléfono marcó o desmarcó algo mientras tanto. Si ya no queda nada sin
    // revisar no hay nada que preguntar; si queda, se pregunta con el número de ahora.
    if (r.confirmar === 0) void terminar(0);
    else setTerminarConfirmar(r.confirmar);
  }

  function reabrir() {
    void correr("reabrir", () => reabrirElLevante(data.evento.id));
  }

  /** Da de baja del stock lo que no volvió. Una sola vez: el servidor lo
   *  garantiza aunque se toque dos veces o desde dos teléfonos. */
  function descontar(i: Item, motivo: MotivoBaja) {
    if (enVuelo.has(i.clave)) return;
    vibrar(PATRON.tildar);
    void correr(i.clave, () => descontarItem(data.evento.id, i.clave, motivo));
  }

  /** Salta a un sector sin tocar el historial (ver `saltarA` en Preparar). */
  function saltarA(id: string) {
    return (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(id)?.scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "start" });
    };
  }

  const sectores = seccionesDeLevante(data.items);
  const resumen = resumenDeLevante(data.items);

  function pedirTerminar() {
    if (resumen.sinRevisar > 0) setTerminarConfirmar(resumen.sinRevisar);
    else void terminar(0);
  }

  // Si la pantalla se actualizó y la fila de la hoja ya no es la que se abrió
  // (otro teléfono la marcó, cambió el pedido, o se terminó el levante), la hoja
  // se cierra: guardar daría por hecho algo que nadie leyó.
  if (hoja !== null && (!data.puedeMarcar || !data.items.some((i) => sigueComoSeAbrio(hoja, i)))) setHoja(null);

  return (
    <>
      {/* Se actualiza sola: dos personas levantan a la vez con su teléfono. */}
      <RefrescoPeriodico />
      <div className="prep-cabecera">
        <div className="prep-cabecera-fila">
          <Link href="/preparar" className="prep-volver" aria-label="Volver a Preparar">{IconBack}</Link>
          <div className="prep-titulo">
            <h1>{data.evento.lugar}</h1>
            <span className="prep-cuando">
              Levante · {data.evento.esHoy ? <span className="prep-hoy">HOY</span> : null} {data.evento.cuando}
            </span>
          </div>
        </div>
        {sectores.length > 1 && (
          <nav className="prep-saltos" aria-label="Ir a un sector">
            {sectores.map((s) => (
              <a
                key={s.category}
                href={`#sector-${s.category}`}
                className={`prep-salto${s.pendientes === 0 ? " ok" : ""}`}
                onClick={saltarA(`sector-${s.category}`)}
              >
                {s.label} {s.marcados}/{s.total}
              </a>
            ))}
          </nav>
        )}
        {error && <MensajeDeError className="prep-error">{error.texto}</MensajeDeError>}
      </div>

      <div className="content prep-contenido">
        {data.terminado && (
          <div className="banner ok lev-terminado" role="status">
            <div className="lev-terminado-texto">
              <b>Levante terminado</b>
              <span>{data.terminado.por}</span>
              <span>{textoDeCierre(resumen)}</span>
            </div>
            {data.puedeAjustarStock && (
              <button type="button" className="btn ghost" onClick={reabrir} disabled={enVuelo.has("reabrir")}>
                Reabrir levante
              </button>
            )}
          </div>
        )}
        {!data.terminado && !data.puedeMarcar && (
          <p className="prep-solo-lectura">Solo lectura: marcan el depósito, logística y la administradora.</p>
        )}

        {sectores.map((s) => (
          <section key={s.category} id={`sector-${s.category}`} className="prep-seccion">
            {/* El botón fuera del h2: si no, el nombre del título leído por un
                lector de pantalla sería "Enseres 1/5 Tachar todo". */}
            <div className="prep-seccion-cab">
              <h2>
                {s.label} <span className={`count-pill${s.pendientes === 0 ? " ok" : ""}`}>{s.marcados}/{s.total}</span>
              </h2>
              {/* Un sector viejo o desconocido se marca de a uno, pero tachar todo
                  solo acepta los sectores vigentes. */}
              {data.puedeMarcar && s.pendientes > 0 && esCategoria(s.category) && (
                <button
                  type="button"
                  className="btn ghost prep-sector-btn"
                  onClick={() =>
                    setSectorAConfirmar({
                      category: s.category,
                      vistos: s.filas.filter((i) => i.estado === "PENDIENTE").map((i) => ({ clave: i.clave, qty: i.qty })),
                    })
                  }
                  disabled={enVuelo.has(`sector:${s.category}`)}
                  aria-label={`Tachar todo ${s.label}`}
                >
                  Tachar todo
                </button>
              )}
            </div>
            {s.filas.map((i) => (
              <Fila
                key={i.clave}
                item={i}
                puedeMarcar={data.puedeMarcar}
                ocupada={enVuelo.has(i.clave)}
                alTocar={() => alternar(i)}
                alFalta={() => abrirHoja(i)}
                puedeDescontar={data.terminado !== null && data.puedeAjustarStock}
                alDescontar={(motivo) => descontar(i, motivo)}
              />
            ))}
          </section>
        ))}

        {data.items.length === 0 && (
          <div className="empty-card">
            <p className="empty-title">No hay nada para levantar</p>
            <p>El pedido de este evento no tiene nada que vuelva al depósito.</p>
          </div>
        )}

        {data.puedeMarcar && data.items.length > 0 && (
          <section className="lev-terminar">
            <p className="prep-nada">
              {resumen.sinRevisar === 0
                ? "Está todo revisado."
                : `${resumen.sinRevisar === 1 ? "Queda 1" : `Quedan ${resumen.sinRevisar}`} sin revisar.`}
            </p>
            <button type="button" className="btn primary lev-terminar-btn" onClick={pedirTerminar} disabled={enVuelo.has("terminar")}>
              Terminar levante
            </button>
          </section>
        )}
      </div>

      {hoja && (
        // Es un formulario: no se cierra deslizando (`sinDeslizar`), y Enter en
        // el campo guarda. Escape y el foco los pone la base.
        <Dialogo titulo="¿Cuántos faltan?" onCerrar={() => setHoja(null)} sinDeslizar alEnviar={() => guardarHoja(hoja)}>
          <div className="msub">{hoja.itemName} · se mandaron {hoja.qty}{unidad(hoja.unit)}</div>
          <div className="stepper-row">
            <button type="button" className="step-btn" onClick={() => pasoHoja(-1)} aria-label="Uno menos">−</button>
            <input
              className="step-input"
              type="number"
              onWheel={sinRueda}
              inputMode="numeric"
              min={1}
              max={hoja.qty}
              step={1}
              value={hoja.valor}
              onChange={(e) => setHoja({ ...hoja, valor: e.target.value })}
              aria-label="Cuántos faltan"
            />
            <button type="button" className="step-btn" onClick={() => pasoHoja(1)} aria-label="Uno más">+</button>
          </div>
          <div className="delta-line" aria-live="polite">{textoDeVuelta(hoja)}</div>
          <div className="modal-actions">
            {/* El foco arranca en Cancelar: un Enter de más no guarda nada. */}
            <button type="button" className="btn ghost" onClick={() => setHoja(null)} autoFocus>Cancelar</button>
            {hoja.estado === "FALTA" && (
              <button type="button" className="btn ghost" onClick={() => desmarcarHoja(hoja)}>Desmarcar</button>
            )}
            <button type="submit" className="btn primary" disabled={!esFaltaValida(Number(hoja.valor), hoja.qty)}>
              Guardar
            </button>
          </div>
        </Dialogo>
      )}

      {sectorAConfirmar && (
        <Confirmar
          titulo={<>¿Tachar todo {sectores.find((s) => s.category === sectorAConfirmar.category)?.label ?? sectorAConfirmar.category}?</>}
          textoConfirmar="Tachar"
          accion={() => tacharSector(sectorAConfirmar)}
          onCerrar={() => setSectorAConfirmar(null)}
        >
          Se marca que volvió todo lo pendiente del sector. Lo que ya marcaste no cambia.
        </Confirmar>
      )}

      {terminarConfirmar !== null && (
        <Confirmar
          titulo={terminarConfirmar === 1 ? "Queda 1 sin revisar" : `Quedan ${terminarConfirmar} sin revisar`}
          textoConfirmar="Terminar igual"
          textoCancelar="Seguir revisando"
          accion={() => void terminar(terminarConfirmar)}
          onCerrar={() => setTerminarConfirmar(null)}
        >
          Quedan como sin revisar, no como faltantes. Después no se puede marcar más: para corregir, la administradora lo reabre.
        </Confirmar>
      )}
    </>
  );
}

function Fila({
  item: i,
  puedeMarcar,
  ocupada,
  alTocar,
  alFalta,
  puedeDescontar,
  alDescontar,
}: {
  item: Item;
  puedeMarcar: boolean;
  ocupada: boolean;
  alTocar: () => void;
  alFalta: () => void;
  puedeDescontar: boolean;
  alDescontar: (motivo: MotivoBaja) => void;
}) {
  const volvio = i.estado === "VOLVIO";
  const falta = i.estado === "FALTA";
  // Lo descontado ya movió el stock: no se toca, ni con el levante reabierto.
  const tocable = puedeMarcar && i.descontado === null;
  // "Falta" es hermano de la fila y no hijo: una fila que es un <button> no
  // puede contener otros botones.
  return (
    <div className="lev-fila-caja">
      <div className="lev-fila-linea">
        <button
          type="button"
          className={`prep-fila estado-${i.estado.toLowerCase()}${ocupada ? " ocupada" : ""}`}
          onClick={alTocar}
          disabled={!tocable || ocupada}
          role="checkbox"
          aria-checked={volvio ? true : falta ? "mixed" : false}
        >
          <span className="prep-check" aria-hidden="true">{volvio ? "✓" : falta ? "!" : ""}</span>
          <span className="prep-item">
            <span className="prep-nombre">{i.itemName}</span>
            {falta && (
              <span className="lev-faltan">
                {i.faltan === 1 ? "Falta" : "Faltan"} {i.faltan} de {i.qty}{unidad(i.unit)}
              </span>
            )}
            {i.descontado && <span className="lev-descontado">Descontado ({i.descontado})</span>}
            {i.note && <span className="prep-nota"><span aria-hidden="true">✎</span> {i.note}</span>}
            {i.marcadoPor && <span className="prep-por">{i.marcadoPor}</span>}
          </span>
          <span className="prep-cantidad">
            {i.qty}
            <small>{unidad(i.unit)}</small>
          </span>
        </button>
        {tocable && (
          <button
            type="button"
            className="btn ghost lev-falta-btn"
            onClick={alFalta}
            disabled={ocupada}
            aria-label={`${falta ? "Corregir lo que falta de" : "Falta"} ${i.itemName}`}
          >
            {falta ? "Corregir" : "Falta"}
          </button>
        )}
      </div>
      {/* Lo que hace la administradora con un faltante, pegado debajo de la fila.
          Lo que no se descuenta no toca el stock: queda anotado y se dice por qué. */}
      {puedeDescontar && falta && i.descontado === null && i.baja !== null && (
        i.baja === "DESCONTABLE" ? (
          <div className="lev-baja" role="group" aria-label={`Descontar ${i.itemName} del stock`}>
            <span className="lev-baja-texto">Dar de baja {i.bajan}{unidad(i.unit)} del stock por</span>
            <button type="button" className="btn ghost" onClick={() => alDescontar("ROTURA")} disabled={ocupada}>Rotura</button>
            <button type="button" className="btn ghost" onClick={() => alDescontar("PERDIDA")} disabled={ocupada}>Pérdida</button>
          </div>
        ) : (
          <p className="lev-baja-nota">{TEXTO_DE_BAJA[i.baja]}</p>
        )
      )}
    </div>
  );
}
