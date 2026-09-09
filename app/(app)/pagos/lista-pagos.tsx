"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { pagar, asignarEntidad } from "@/app/actions/comprobantes";
import { formatear } from "@/lib/money";
import { aporteAlSaldo } from "@/lib/comprobantes/politica";
import { diasEntre } from "@/lib/dates";

// La pantalla de quien paga.
//
// La decisión que ordena todo: **acá no se eligen facturas, se compone una
// transferencia**. Por eso la selección suma en vivo y está limitada a un
// proveedor por vez — un total que mezcla dos proveedores no se le transfiere a
// nadie, y ofrecerlo es invitar a un error que después hay que perseguir.

type Fila = {
  id: string;
  nombre: string;
  kind: string;
  vencimiento: string | null;
  total: string | null; // centavos en texto: BigInt no cruza como JSON
};

type Duplicado = { nombre: string; importe: string; documentIds: string[] };

/** Un comprobante al que le falta algo para poder pagarse, con el motivo. */
type Incompleto = { id: string; nombre: string; kind: string; falta: string[] };

export default function ListaPagos({
  hoy,
  deuda,
  vencen,
  bandejas,
  duplicados,
  incompletos,
  entidades,
  entidadElegida,
  sinEntidad,
  huerfanos,
}: {
  hoy: string;
  deuda: { supplierId: string | null; nombre: string; total: string; cantidad: number; sinImporte: number }[];
  vencen: Fila[];
  bandejas: { sinProveedor: number; sinRevisar: number; sinVencimiento: number };
  duplicados: Duplicado[];
  incompletos: Incompleto[];
  /** A nombre de quién puede estar la factura. Vacío = todavía no se dio de alta ninguna. */
  entidades: { id: string; nombre: string }[];
  /** El filtro puesto: un id, `"sin"`, o `""` para todas. */
  entidadElegida: string;
  /** Cuántos comprobantes quedaron sin entidad asignada. */
  sinEntidad: number;
  /** Y cuáles son. Sin esto la bandeja sería un número que nadie puede bajar. */
  huerfanos: {
    id: string;
    nombre: string;
    kind: string;
    fechaEmision: string | null;
    importeTotal: string | null;
  }[];
}) {
  const router = useRouter();
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [guardando, setGuardando] = useState(false);
  const [verFoto, setVerFoto] = useState<Fila | null>(null);
  // Se transfiere primero y se registra al otro día tan seguido como al revés,
  // así que la fecha del pago es editable. Arranca en hoy, que es el caso común.
  const [diaPago, setDiaPago] = useState(hoy);
  const [copiado, setCopiado] = useState(false);
  const [aviso, setAviso] = useState<{ tono: "bien" | "ojo" | "mal"; texto: string } | null>(null);
  /** Qué huérfano se está guardando. Por id y no un booleano: se pueden asignar
   *  varios seguidos y el que espera tiene que ser el que se toca. */
  const [asignando, setAsignando] = useState<string | null>(null);

  /**
   * Le pone entidad a un comprobante huérfano.
   *
   * El resultado se MIRA. Descartarlo dejaría la fila igual que si hubiera
   * andado, y quien está ordenando se iría convencido de haber asignado algo
   * que sigue suelto — que es la misma clase de silencio que ya mordió en esta
   * pantalla con los pagos.
   */
  async function asignar(documentId: string, entidadId: string) {
    if (!entidadId || asignando) return;
    setAsignando(documentId);
    setAviso(null);
    const r = await asignarEntidad(documentId, entidadId);
    setAsignando(null);
    if (!r.ok) {
      setAviso({ tono: "mal", texto: r.error });
      return;
    }
    router.refresh();
  }

  const porId = useMemo(() => new Map(vencen.map((f) => [f.id, f])), [vencen]);

  // De quién es la selección. Al ser de un solo proveedor, el total significa
  // algo: es exactamente lo que se va a transferir.
  const proveedorElegido = useMemo(() => {
    const primera = [...elegidas][0];
    return primera ? (porId.get(primera)?.nombre ?? null) : null;
  }, [elegidas, porId]);

  const totalElegido = useMemo(
    () => [...elegidas].reduce((acc, id) => acc + BigInt(porId.get(id)?.total ?? "0"), 0n),
    [elegidas, porId],
  );

  function alternar(f: Fila) {
    setElegidas((prev) => {
      const s = new Set(prev);
      if (s.has(f.id)) {
        s.delete(f.id);
        return s;
      }
      // No se mezcla con otro proveedor: sumar dos da un número que no se le
      // transfiere a nadie. Los de otro proveedor están deshabilitados mientras
      // haya una selección abierta, así que acá no debería llegar ninguno.
      if (proveedorElegido && proveedorElegido !== f.nombre) return prev;
      s.add(f.id);
      return s;
    });
  }

  async function copiarTotal() {
    // Sin separador de miles y con coma: es como se tipea un importe en el
    // homebanking, y pegarlo con puntos de miles lo rechaza.
    const plano = formatear(totalElegido).replace("$ ", "").replace(/\./g, "");
    try {
      await navigator.clipboard.writeText(plano);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      /* sin permiso de portapapeles no pasa nada: el número está a la vista */
    }
  }

  async function marcarPagadas() {
    setGuardando(true);
    setAviso(null);
    try {
      const r = await pagar([...elegidas], diaPago);

      // El resultado se mira. Antes se descartaba y la seleccion se limpiaba
      // pase lo que pasase: si la accion fallaba —sin permiso, fecha invalida,
      // base caida— la pantalla quedaba igual que si hubiera andado, y quien
      // paga se iba convencida de haber marcado ocho facturas que seguian
      // pendientes. En una pantalla de plata, un error silencioso es peor que
      // un error a los gritos.
      if (!r.ok) {
        setAviso({ tono: "mal", texto: r.error ?? "No se pudo registrar el pago." });
        return; // la seleccion NO se limpia: sigue ahi para reintentar
      }

      // Puede haber salido bien "a medias": comprobantes que ya estaban
      // pagados, o que otra persona anulo mientras esta pantalla estaba
      // abierta. Decirlo es la unica forma de que los numeros del homebanking y
      // los de la pantalla se puedan comparar.
      const sobras = r.yaEstaban + r.noSePagan + r.noEncontrados;
      setAviso(
        sobras === 0
          ? { tono: "bien", texto: `${r.marcados} marcado${r.marcados === 1 ? "" : "s"} como pagado${r.marcados === 1 ? "" : "s"}.` }
          : {
              tono: "ojo",
              texto: [
                `${r.marcados} marcado${r.marcados === 1 ? "" : "s"}.`,
                r.yaEstaban ? `${r.yaEstaban} ya figuraba${r.yaEstaban === 1 ? "" : "n"} como pagado${r.yaEstaban === 1 ? "" : "s"}.` : "",
                r.noSePagan ? `${r.noSePagan} no se paga${r.noSePagan === 1 ? "" : "n"} (remito o nota).` : "",
                r.noEncontrados ? `${r.noEncontrados} ya no esta${r.noEncontrados === 1 ? "" : "n"}.` : "",
              ].filter(Boolean).join(" "),
            },
      );
      setElegidas(new Set());
      router.refresh();
    } catch {
      setAviso({
        tono: "mal",
        texto: "Se cortó la conexión. Ninguno quedó marcado: revisá y volvé a intentar.",
      });
    } finally {
      setGuardando(false);
    }
  }

  const grupos = useMemo(() => agrupar(vencen, hoy), [vencen, hoy]);
  const resumen = useMemo(() => resumir(grupos, deuda), [grupos, deuda]);
  const hayPendientes = incompletos.length > 0 || duplicados.length > 0 || bandejas.sinRevisar > 0;

  return (
    <>
      <header className="topbar">
        <h1>Pagos</h1>
      </header>
      <div className="content">

      {/* El filtro por entidad.
          Aparece solo si hay más de una: con una sola, todo lo que se ve es de
          ella y un filtro que no filtra nada es ruido.

          "Sin asignar" no es un subconjunto de "Todas": es la pregunta de qué
          hay que ir a resolver. Por eso es un botón propio y muestra cuántos
          son — un contador es lo que hace que ese trabajo se termine. */}
      {entidades.length > 1 && (
        <nav className="pg-entidades" aria-label="Filtrar por entidad">
          <Link href="/pagos" className={`pg-ent${entidadElegida === "" ? " elegida" : ""}`}>
            Todas
          </Link>
          {entidades.map((e) => (
            <Link
              key={e.id}
              href={`/pagos?entidad=${e.id}`}
              className={`pg-ent${entidadElegida === e.id ? " elegida" : ""}`}
            >
              {e.nombre}
            </Link>
          ))}
          {sinEntidad > 0 && (
            <Link
              href="/pagos?entidad=sin"
              className={`pg-ent aviso${entidadElegida === "sin" ? " elegida" : ""}`}
            >
              Sin asignar ({sinEntidad})
            </Link>
          )}
        </nav>
      )}

      {/* Cuando el filtro está puesto, los totales de abajo son de UNA entidad.
          Decirlo es la diferencia entre un número y un número que significa
          algo. */}
      {entidadElegida !== "" && (
        <p className="msub">
          {entidadElegida === "sin"
            ? "Mostrando solo los comprobantes que quedaron sin entidad asignada."
            : `Mostrando solo ${entidades.find((e) => e.id === entidadElegida)?.nombre ?? "una entidad"}. Los totales son de esa entidad.`}
        </p>
      )}

      {/* La bandeja de huérfanos, ABIERTA.
          Solo se muestra cuando el filtro está en "sin": es trabajo de ordenar,
          no algo que tenga que estorbar cuando se está por pagar. */}
      {entidadElegida === "sin" && (
        <section className="pg-huerfanos">
          {huerfanos.length === 0 ? (
            <p className="msub">Todos los comprobantes tienen entidad. No queda nada por asignar.</p>
          ) : (
            <>
              <p className="msub">
                Estos comprobantes no tienen entidad. Elegí de quién es cada uno: hasta entonces no
                suman en la deuda de ninguna.
              </p>
              <ul className="pg-huerfanos-lista">
                {huerfanos.map((h) => (
                  <li key={h.id}>
                    <div className="pg-huerfano-info">
                      <strong>{h.nombre}</strong>
                      <span className="msub">
                        {h.kind === "FACTURA" ? "Factura" : h.kind.toLowerCase()}
                        {h.fechaEmision ? ` · ${h.fechaEmision}` : ""}
                        {h.importeTotal ? ` · ${formatear(BigInt(h.importeTotal))}` : " · sin importe"}
                      </span>
                    </div>
                    <select
                      aria-label={`Entidad de ${h.nombre}`}
                      defaultValue=""
                      disabled={asignando === h.id}
                      onChange={(ev) => void asignar(h.id, ev.target.value)}
                    >
                      <option value="" disabled>
                        {asignando === h.id ? "Guardando…" : "Elegir…"}
                      </option>
                      {entidades.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.nombre}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* El estado de la deuda, en una línea.
          Va ARRIBA de la alarma de duplicados a propósito: primero en qué
          tamaño de problema estás, después qué revisar. */}
      {resumen.todo.cantidad > 0 && (
        <dl className="pg-resumen">
          {resumen.vencido.cantidad > 0 && (
            <div className="pg-resumen-item pg-resumen-vencido">
              <dt>Vencido</dt>
              <dd>
                {formatear(resumen.vencido.total)}
                <span className="pg-resumen-detalle">
                  {resumen.vencido.cantidad} comprobante{resumen.vencido.cantidad === 1 ? "" : "s"}
                </span>
              </dd>
            </div>
          )}
          {resumen.semana.cantidad > 0 && (
            <div className="pg-resumen-item">
              <dt>Esta semana</dt>
              <dd>
                {formatear(resumen.semana.total)}
                <span className="pg-resumen-detalle">
                  {resumen.semana.cantidad} comprobante{resumen.semana.cantidad === 1 ? "" : "s"}
                </span>
              </dd>
            </div>
          )}
          <div className="pg-resumen-item">
            <dt>Total pendiente</dt>
            <dd>
              {formatear(resumen.todo.total)}
              <span className="pg-resumen-detalle">
                {resumen.todo.cantidad} comprobante{resumen.todo.cantidad === 1 ? "" : "s"}
                {/* Un total que se come los comprobantes sin importe da un
                    número más chico que la deuda real. Decirlo es la diferencia
                    entre un dato y una tranquilidad falsa. */}
                {resumen.todo.sinImporte > 0 && (
                  <span className="pg-resumen-incompleto">
                    {" "}· faltan {resumen.todo.sinImporte} sin importe
                  </span>
                )}
              </span>
            </dd>
          </div>
        </dl>
      )}

      {duplicados.length > 0 && (
        <section className="pg-alerta" role="alert">
          <strong>Puede que estés por pagar dos veces lo mismo.</strong>
          <ul>
            {duplicados.map((d) => (
              <li key={d.documentIds.join("-")}>
                {d.nombre} · {formatear(BigInt(d.importe))} · {d.documentIds.length} comprobantes casi iguales
              </li>
            ))}
          </ul>
        </section>
      )}

      {vencen.length === 0 ? (
        <div className="empty-card">
          <p>No hay nada por vencer.</p>
          <p className="hint">
            Acá aparecen los comprobantes con fecha de pago cargada. Los que todavía no la tienen
            están en pendientes, abajo.
          </p>
        </div>
      ) : (
        grupos.map((g) => (
          <section key={g.titulo} className="pg-grupo">
            <h2 className={`section-title${g.vencido ? " pg-vencido" : ""}`}>
              {g.titulo}
              <span className="count-pill">{g.filas.length}</span>
            </h2>

            <div className="tablewrap">
              <table className="pg-tabla pg-tabla-vence">
                <caption className="sr-only">{g.titulo}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="pg-check" />
                    <th scope="col">Proveedor</th>
                    <th scope="col">Vence</th>
                    <th scope="col" className="pg-num">Importe</th>
                    <th scope="col" className="pg-ver"><span className="sr-only">Ver</span></th>
                  </tr>
                </thead>
                <tbody>
                  {g.filas.map((f) => {
                    const elegida = elegidas.has(f.id);
                    const bloqueada = !!proveedorElegido && proveedorElegido !== f.nombre;
                    return (
                      <tr
                        key={f.id}
                        className={`pg-fila${elegida ? " pg-elegida" : bloqueada ? " pg-otra" : ""}`}
                        onClick={() => setVerFoto(f)}
                      >
                        <td className="pg-check" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={elegida}
                            disabled={bloqueada}
                            onChange={() => alternar(f)}
                            aria-label={
                              bloqueada
                                ? `${f.nombre}: para elegirlo, deshacé la selección de ${proveedorElegido}`
                                : `Elegir ${f.nombre} de ${f.vencimiento ?? "sin fecha"}`
                            }
                          />
                        </td>
                        <td className="pg-c-nombre">
                          {/* Botón de verdad y no solo una fila clicable: con
                              teclado una fila no se puede enfocar, y quien paga
                              mira el comprobante de todas. */}
                          <button type="button" className="pg-nombre">
                            {f.nombre}
                          </button>
                          {f.kind !== "FACTURA" && <span className="pg-tipo">{etiqueta(f.kind)}</span>}
                        </td>
                        <td className="pg-c-vence">{f.vencimiento ? legible(f.vencimiento) : "—"}</td>
                        <td className="pg-num">{f.total ? formatear(BigInt(f.total)) : "—"}</td>
                        {/* Dos acciones distintas y con nombres distintos: el
                            COMPROBANTE es la foto del papel —lo que vale ante un
                            tercero— y el DETALLE es la hoja que arma el sistema.
                            Un solo icono para las dos garantizaba que alguna vez
                            alguien mandara la reconstrucción creyendo que
                            mandaba la factura. */}
                        <td className="pg-ver" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="pg-accion"
                            onClick={() => setVerFoto(f)}
                            title="Ver el comprobante"
                            aria-label={`Ver el comprobante de ${f.nombre}`}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                              <circle cx="12" cy="12" r="2.6" />
                            </svg>
                          </button>
                          <a
                            className="pg-accion"
                            href={`/api/comprobantes/${f.id}/documento`}
                            target="_blank"
                            rel="noopener"
                            title="Ver el detalle"
                            aria-label={`Ver el detalle de ${f.nombre}`}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                              <path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" />
                              <path d="M9 12h6M9 16h6" />
                            </svg>
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      <h2 className="section-title">Por proveedor</h2>
      {deuda.length === 0 ? (
        <div className="empty-card">
          <p>No hay deuda registrada.</p>
        </div>
      ) : (
        <div className="tablewrap">
          <table className="pg-tabla pg-tabla-deuda">
            <thead>
              <tr>
                <th scope="col">Proveedor</th>
                <th scope="col" className="pg-num">Comprobantes</th>
                <th scope="col" className="pg-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {deuda.map((d) => (
                <tr key={d.supplierId ?? "sin"}>
                  <td className="pg-c-nombre">{d.nombre}</td>
                  <td className="pg-num pg-c-cant">{d.cantidad}</td>
                  <td className="pg-num pg-fuerte">
                    {formatear(BigInt(d.total))}
                    {/* Un comprobante sin importe NO es un importe de cero.
                        Mostrando solo el total, un proveedor cuyo único
                        comprobante todavía no tiene importe aparecía como
                        "$ 0,00" — que se lee como "no debe nada" cuando lo que
                        pasa es que no se sabe cuánto. El dato se calculaba y
                        se tiraba antes de llegar a la pantalla. */}
                    {d.sinImporte > 0 && (
                      <span className="pg-sin-importe">
                        + {d.sinImporte} sin importe
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hayPendientes && (
        <>
          <h2 className="section-title">Falta resolver</h2>

          {/* Cada fila abre la pantalla donde se completa. Antes esto era una
              lista de números: "3 sin proveedor", sin forma de abrir esos tres.
              Un contador que no se puede tocar avisa que hay trabajo y no deja
              hacerlo, y eso es exactamente cómo una bandeja se deja de mirar. */}
          {incompletos.length > 0 && (
            <ul className="pg-faltantes">
              {incompletos.map((f) => (
                <li key={f.id}>
                  <Link href={`/pagos/completar/${f.id}`}>
                    <span className="pg-faltantes-quien">{f.nombre}</span>
                    <span className="pg-faltantes-que">Falta {f.falta.join(", ")}</span>
                    <span className="pg-faltantes-ir" aria-hidden="true">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {bandejas.sinRevisar > 0 && (
            <p className="hint">
              <strong>{bandejas.sinRevisar}</strong> sin revisar la recepción.
            </p>
          )}
        </>
      )}

      {aviso && (
        <div className={`pg-aviso pg-aviso-${aviso.tono}`} role="status" aria-live="polite">
          {aviso.texto}
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso">×</button>
        </div>
      )}

      {/* La barra aparece solo cuando hay algo elegido: lo que se está armando
          es una transferencia, y el número que muestra es exactamente el que se
          va a transferir. */}
      {elegidas.size > 0 && (
        <div className="pg-barra" role="region" aria-label="Selección para pagar">
          <div className="pg-barra-datos">
            <span className="pg-barra-prov">{proveedorElegido}</span>
            <button
              type="button"
              className="pg-barra-total"
              onClick={copiarTotal}
              title="Copiar el total para pegarlo en el homebanking"
            >
              {formatear(totalElegido)}
              <span className="pg-copiar">{copiado ? "copiado" : "copiar"}</span>
            </button>
            <span className="pg-barra-cuenta">
              {elegidas.size} {elegidas.size === 1 ? "comprobante" : "comprobantes"}
            </span>
          </div>
          <div className="pg-barra-acciones">
            <label className="pg-fecha">
              Pagado el
              <input type="date" value={diaPago} onChange={(e) => setDiaPago(e.target.value)} />
            </label>
            <button type="button" className="btn ghost" onClick={() => setElegidas(new Set())}>
              Deshacer
            </button>
            <button type="button" className="btn primary" onClick={marcarPagadas} disabled={guardando}>
              {guardando ? "Guardando…" : "Marcar pagadas"}
            </button>
          </div>
        </div>
      )}

      {verFoto && (
        <div className="overlay" onClick={() => setVerFoto(null)}>
          <div className="pg-visor" onClick={(e) => e.stopPropagation()}>
            <header>
              <strong>{verFoto.nombre}</strong>
              {/* Desde la foto se llega al detalle, que es donde alguien está
                  cuando quiere leer los renglones sin pelearse con el papel. */}
              <a
                className="btn ghost"
                href={`/api/comprobantes/${verFoto.id}/documento`}
                target="_blank"
                rel="noopener"
              >
                Ver el detalle
              </a>
              <button type="button" className="btn ghost" onClick={() => setVerFoto(null)}>
                Cerrar
              </button>
            </header>
            {/* El visor reemplaza tener el papel en la mano: quien paga está en
                otra oficina y no puede ir a mirarlo. */}
            <img src={`/api/comprobantes/${verFoto.id}/foto`} alt={`Comprobante de ${verFoto.nombre}`} />
          </div>
        </div>
      )}
      </div>
    </>
  );
}

/** Vencidos primero y aparte: lo urgente se distingue por dónde está, no solo
 *  por el color — quien no distingue rojos tiene que verlo igual. */
function agrupar(filas: Fila[], hoy: string) {
  const vencidas = filas.filter((f) => f.vencimiento && f.vencimiento < hoy);
  const estaSemana = filas.filter(
    (f) => f.vencimiento && f.vencimiento >= hoy && diasEntre(hoy, f.vencimiento) <= 7,
  );
  const despues = filas.filter(
    (f) => f.vencimiento && f.vencimiento >= hoy && diasEntre(hoy, f.vencimiento) > 7,
  );

  return [
    { titulo: "Vencidas", filas: vencidas, vencido: true },
    { titulo: "Esta semana", filas: estaSemana, vencido: false },
    { titulo: "Más adelante", filas: despues, vencido: false },
  ].filter((g) => g.filas.length > 0);
}

/**
 * Los tres numeros que contestan "cuanto debo" sin scrollear.
 *
 * **No reemplaza a la lista.** La pantalla abre en "que vence" y no en un
 * tablero, y eso esta bien: la pregunta que trae a alguien aca es "que pago
 * hoy", y una lista ordenada por urgencia la contesta mas rapido que unas
 * cifras. Esto no compite — la enmarca. Quien abre quiere saber en que tamano
 * de problema esta antes de empezar a leer filas.
 *
 * **`sinImporte` viaja con el total y no es un detalle.** Un comprobante sin
 * importe NO es un importe de cero: sumarlo como cero da un numero mas chico
 * que la deuda real, y ese es exactamente el error que hace que alguien crea
 * que llega a fin de mes.
 */
function resumir(
  grupos: { titulo: string; filas: Fila[]; vencido: boolean }[],
  deuda: { total: string; cantidad: number; sinImporte: number }[],
) {
  const deUnGrupo = (titulo: string) => {
    const g = grupos.find((x) => x.titulo === titulo);
    if (!g) return { total: 0n, cantidad: 0, sinImporte: 0 };
    return {
      // El signo lo decide el TIPO, con la misma regla que usa el servidor.
      // Sumar todo derecho hacia que una nota de credito engordara la deuda de
      // la semana en vez de bajarla.
      total: g.filas.reduce((a, f) => a + aporteAlSaldo(f.kind, f.total ? BigInt(f.total) : null), 0n),
      cantidad: g.filas.length,
      sinImporte: g.filas.filter((f) => !f.total).length,
    };
  };
  return {
    vencido: deUnGrupo("Vencidas"),
    semana: deUnGrupo("Esta semana"),
    // El total sale de la deuda por proveedor y NO de los grupos: los grupos
    // solo tienen lo que tiene vencimiento cargado, y lo que no lo tiene se
    // debe igual. Sumar los grupos habria dado un total tranquilizador y falso.
    todo: {
      total: deuda.reduce((a, d) => a + BigInt(d.total), 0n),
      cantidad: deuda.reduce((a, d) => a + d.cantidad, 0),
      sinImporte: deuda.reduce((a, d) => a + d.sinImporte, 0),
    },
  };
}

function legible(dia: string): string {
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

const ETIQUETAS: Record<string, string> = {
  REMITO: "remito",
  TICKET: "ticket",
  NOTA_CREDITO: "nota de crédito",
  NOTA_DEBITO: "nota de débito",
  OTRO: "otro",
};
const etiqueta = (k: string) => ETIQUETAS[k] ?? k.toLowerCase();
