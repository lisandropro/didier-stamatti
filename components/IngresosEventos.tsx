"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarIngreso, borrarIngreso } from "@/app/actions/comprobantes";

// Lo que se le cobró al cliente por cada evento.
//
// **Es el otro lado del margen, y hasta acá no existía.** El sistema sabía
// cuánto costó una fiesta y no cuánto se cobró por ella, así que no podía decir
// si dejó plata.
//
// Tres cosas que la pantalla tiene que dejar claras, porque son las que se
// prestan a confusión:
//
//   - **Comensales no es invitados.** Se cobra por los presupuestados aunque
//     vengan menos. Los invitados se muestran al lado, apagados, justamente
//     para que se vea que son otro número.
//   - **El IVA cambia el neto.** El mismo precio da dos márgenes distintos
//     según lleve el IVA adentro o no, y la diferencia es del 21%.
//   - **Los extras son fijos.** Un kiosco se cobra por kiosco, no por persona.

export type FilaEvento = {
  eventoId: string;
  lugar: string;
  fecha: string;
  invitados: number;
  precioPorPersona: string | null;
  comensales: number | null;
  conIva: boolean | null;
  extras: { id: string; descripcion: string; importe: string }[];
  pactado: { bruto: string; neto: string; iva: string } | null;
  cargadoPor: string | null;
  /** Su parte del costo del período. **Es un reparto, no una medición.** */
  costo: string | null;
  /** Ingreso neto menos costo. Sólo cuando existen las dos mitades. */
  margen: string | null;
  /** Si el costo del período está incompleto: proveedores sin rubro cargado o
   *  comprobantes sin importe. Entonces el margen es provisorio y se dice. */
  costoIncompleto: boolean;
};

export function IngresosEventos({ filas }: { filas: FilaEvento[] }) {
  const cargados = filas.filter((f) => f.pactado);

  return (
    <div className="ing">
      {filas.length === 0 ? (
        <div className="ing-vacio">
          <h2>No hay eventos en este período</h2>
          <p>
            Los eventos se crean desde la pantalla de Período, junto con su pedido. Acá se les
            carga lo que se le cobró al cliente.
          </p>
        </div>
      ) : (
        <>
          <p className="ing-avance">
            {cargados.length === filas.length ? (
              <>
                <strong>Listo.</strong> Los {filas.length} eventos tienen su precio cargado.
              </>
            ) : (
              <>
                <strong>{filas.length - cargados.length}</strong> de {filas.length} eventos todavía
                no tienen precio. Sin eso no se puede calcular el margen.
              </>
            )}
          </p>
          <ul className="ing-lista">
            {filas.map((f) => (
              <Fila key={f.eventoId} f={f} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

type ExtraEditable = { descripcion: string; importe: string };

function Fila({ f }: { f: FilaEvento }) {
  const router = useRouter();
  const [guardando, empezar] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [precio, setPrecio] = useState(f.precioPorPersona ?? "");
  const [comensales, setComensales] = useState(f.comensales == null ? "" : String(f.comensales));
  const [conIva, setConIva] = useState<boolean | null>(f.conIva);
  const [extras, setExtras] = useState<ExtraEditable[]>(
    f.extras.map((e) => ({ descripcion: e.descripcion, importe: e.importe })),
  );

  function guardar() {
    setError(null);
    empezar(async () => {
      const r = await guardarIngreso({
        eventoId: f.eventoId,
        precioPorPersona: precio.trim() === "" ? null : precio,
        comensales: comensales.trim() === "" ? null : Number(comensales),
        conIva,
        extras,
      });
      if (!r.ok) setError(r.error);
      else {
        setAbierto(false);
        router.refresh();
      }
    });
  }

  function borrar() {
    setError(null);
    empezar(async () => {
      const r = await borrarIngreso(f.eventoId);
      if (!r.ok) setError(r.error);
      else {
        setAbierto(false);
        router.refresh();
      }
    });
  }

  if (!abierto) {
    return (
      <li className={f.pactado ? "ing-fila ing-hecha" : "ing-fila"}>
        <div className="ing-quien">
          <span className="ing-nombre">{f.lugar}</span>
          <span className="ing-sub">
            {legible(f.fecha)}
            {/* Se muestra apagado y con nombre propio: es el número que NO
                factura, y verlo al lado evita que alguien lo copie como
                comensales. */}
            <span className="ing-invitados"> · {f.invitados} invitados</span>
          </span>
        </div>
        <div className="ing-plata">
          {f.pactado ? (
            <>
              <span className="ing-neto">{f.pactado.neto}</span>
              <span className="ing-detalle">
                neto · {f.comensales} cubiertos
                {f.conIva == null && (
                  <span className="ing-pendiente"> · falta decir si el precio lleva IVA</span>
                )}
              </span>
              {/* **El costo es un reparto del período, no lo que costó esta
                  fiesta.** Se dice con todas las letras: el sistema no sabe qué
                  se compró para cada evento —la comida no está en el catálogo—
                  y un número que parece medido y no lo es se usa para poner
                  precios. */}
              {f.margen && (
                <span className="ing-margen">
                  margen {f.margen}
                  <span className="ing-aprox">
                    {" "}· costo {f.costo} repartido del período
                    {f.costoIncompleto && ", incompleto"}
                  </span>
                </span>
              )}
            </>
          ) : (
            <span className="ing-sinprecio">sin precio</span>
          )}
          <button type="button" className="ing-editar" onClick={() => setAbierto(true)}>
            {f.pactado ? "cambiar" : "cargar"}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="ing-fila ing-abierta">
      <div className="ing-quien">
        <span className="ing-nombre">{f.lugar}</span>
        <span className="ing-sub">
          {legible(f.fecha)}
          <span className="ing-invitados"> · {f.invitados} invitados</span>
        </span>
      </div>

      <div className="ing-campos">
        <div className="field">
          <label htmlFor={`pp-${f.eventoId}`}>Precio por persona</label>
          <input
            id={`pp-${f.eventoId}`}
            inputMode="decimal"
            value={precio}
            placeholder="12500,00"
            onChange={(e) => setPrecio(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`cm-${f.eventoId}`}>Comensales presupuestados</label>
          <input
            id={`cm-${f.eventoId}`}
            inputMode="numeric"
            value={comensales}
            placeholder={String(f.invitados)}
            onChange={(e) => setComensales(e.target.value)}
          />
          <p className="ing-ayuda">
            Por cuántos se cobra. Si vienen menos, se cobra igual lo presupuestado — por eso no es
            el número de invitados.
          </p>
        </div>
      </div>

      <fieldset className="ing-iva">
        <legend>¿El precio pactado lleva el IVA adentro?</legend>
        <div className="ing-opciones">
          <button
            type="button"
            className={conIva === true ? "ing-op ing-op-on" : "ing-op"}
            aria-pressed={conIva === true}
            onClick={() => setConIva(true)}
          >
            Sí, está incluido
          </button>
          <button
            type="button"
            className={conIva === false ? "ing-op ing-op-on" : "ing-op"}
            aria-pressed={conIva === false}
            onClick={() => setConIva(false)}
          >
            No, se suma aparte
          </button>
        </div>
        <p className="ing-ayuda">
          Cambia el margen en un 21%: el neto es lo único que se puede comparar contra lo que
          costó. A una empresa se le factura con IVA discriminado; a un particular, incluido.
        </p>
      </fieldset>

      <div className="ing-extras">
        <span className="ing-extras-titulo">Extras de importe fijo</span>
        <p className="ing-ayuda">
          Los kioscos y lo que el cliente haya pedido aparte. Se suman al total una vez, no por
          persona.
        </p>
        {extras.map((e, i) => (
          <div key={i} className="ing-extra">
            <input
              aria-label="Qué es"
              value={e.descripcion}
              placeholder="Kiosco de churros"
              onChange={(ev) =>
                setExtras(extras.map((x, j) => (j === i ? { ...x, descripcion: ev.target.value } : x)))
              }
            />
            <input
              aria-label="Importe"
              inputMode="decimal"
              value={e.importe}
              placeholder="350000,00"
              onChange={(ev) =>
                setExtras(extras.map((x, j) => (j === i ? { ...x, importe: ev.target.value } : x)))
              }
            />
            <button
              type="button"
              className="ing-quitar"
              onClick={() => setExtras(extras.filter((_, j) => j !== i))}
            >
              quitar
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn ghost"
          onClick={() => setExtras([...extras, { descripcion: "", importe: "" }])}
        >
          Agregar extra
        </button>
      </div>

      {error && <p className="ing-error">{error}</p>}

      <div className="ing-acciones">
        <button className="btn primary" onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button className="btn ghost" onClick={() => setAbierto(false)} disabled={guardando}>
          Cancelar
        </button>
        {f.pactado && (
          <button type="button" className="ing-borrar" onClick={borrar} disabled={guardando}>
            borrar el precio
          </button>
        )}
        {f.cargadoPor && <span className="ing-firma">Lo cargó {f.cargadoPor}</span>}
      </div>
    </li>
  );
}

/** "2026-09-20" → "20/09/2026". */
function legible(dia: string): string {
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}
