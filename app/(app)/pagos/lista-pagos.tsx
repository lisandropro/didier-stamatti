"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { pagar } from "@/app/actions/comprobantes";
import { formatear } from "@/lib/money";
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

export default function ListaPagos({
  hoy,
  deuda,
  vencen,
  bandejas,
  duplicados,
}: {
  hoy: string;
  deuda: { supplierId: string | null; nombre: string; total: string; cantidad: number }[];
  vencen: Fila[];
  bandejas: { sinProveedor: number; sinRevisar: number; sinVencimiento: number };
  duplicados: Duplicado[];
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
  const hayPendientes = bandejas.sinProveedor + bandejas.sinVencimiento > 0 || duplicados.length > 0;

  return (
    <>
      <header className="topbar">
        <h1>Pagos</h1>
      </header>
      <div className="content">

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
              <table className="pg-tabla">
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
                        <td>
                          {/* Botón de verdad y no solo una fila clicable: con
                              teclado una fila no se puede enfocar, y quien paga
                              mira el comprobante de todas. */}
                          <button type="button" className="pg-nombre">
                            {f.nombre}
                          </button>
                          {f.kind !== "FACTURA" && <span className="pg-tipo">{etiqueta(f.kind)}</span>}
                        </td>
                        <td>{f.vencimiento ? legible(f.vencimiento) : "—"}</td>
                        <td className="pg-num">{f.total ? formatear(BigInt(f.total)) : "—"}</td>
                        <td className="pg-ver" aria-hidden>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                            <circle cx="12" cy="12" r="2.6" />
                          </svg>
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
          <table className="pg-tabla">
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
                  <td>{d.nombre}</td>
                  <td className="pg-num">{d.cantidad}</td>
                  <td className="pg-num pg-fuerte">{formatear(BigInt(d.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hayPendientes && (
        <>
          <h2 className="section-title">Falta resolver</h2>
          <ul className="pg-pendientes">
            {bandejas.sinVencimiento > 0 && (
              <li>
                <strong>{bandejas.sinVencimiento}</strong> sin fecha de pago
              </li>
            )}
            {bandejas.sinProveedor > 0 && (
              <li>
                <strong>{bandejas.sinProveedor}</strong> sin proveedor
              </li>
            )}
            {bandejas.sinRevisar > 0 && (
              <li>
                <strong>{bandejas.sinRevisar}</strong> sin revisar la recepción
              </li>
            )}
          </ul>
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
