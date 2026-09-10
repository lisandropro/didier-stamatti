"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acordarCondicion, olvidarCondicion } from "@/app/actions/comprobantes";
import { sumarDias } from "@/lib/dates";

// A cuántos días se le paga a cada proveedor.
//
// **Es un acuerdo, no un formulario.** Lo pactó una persona con el proveedor,
// así que la fila guarda quién lo cargó y cuándo, y se puede deshacer: cargar
// mal es fácil, y si nadie puede volver atrás la respuesta a la duda termina
// siendo dejar cualquier cosa.
//
// **Para qué sirve, que es lo que hace que valga la pena llenarla.** Con el
// plazo cargado, cada factura recibe su fecha de pago calculada —emisión más
// los días— en vez de pedir que alguien tipee ciento cuarenta y cinco fechas.
// Por eso la fila muestra, apenas elegís, qué le pasaría a la factura más vieja
// de ese proveedor: es la forma de darse cuenta en el momento de que el número
// está mal.
//
// **El orden no es alfabético.** Son más de cien proveedores y trece concentran
// el 80% de la plata. Primero los que deben y no tienen plazo cargado —ése es
// el trabajo—, y dentro de eso, los de más deuda arriba.
//
// **La fila cargada se colapsa a una línea.** La primera versión resaltaba las
// que faltaban, y como al empezar faltan todas, resaltaba las cincuenta y
// nueve: un resalte que abarca todo no resalta nada, y siete botones por fila
// eran cuatrocientos botones en pantalla. Al revés funciona: lo hecho se
// achica, la lista se acorta sola, y lo que queda por hacer es lo que ocupa
// lugar.

type Condicion =
  | { estado: "sin-cargar" }
  | { estado: "dias"; dias: number }
  | { estado: "sin-plazo" };

export type FilaProveedor = {
  id: string;
  nombre: string;
  cuit: string | null;
  condicion: Condicion;
  acordadaPor: string | null;
  acordadaAt: string | null;
  deuda: string;
  comprobantes: number;
  sinImporte: number;
  masVieja: string | null;
};

/** Los plazos que se usan de verdad, confirmados por el usuario. La lista corta
 *  es deliberada: un botón que nadie aprieta es ruido, y acá cada opción de más
 *  es una decisión de más para alguien que tiene que pasar por cien filas. */
const PLAZOS: { valor: string; etiqueta: string; dias?: boolean; ultimoDias?: boolean }[] = [
  { valor: "0", etiqueta: "Contado" },
  { valor: "7", etiqueta: "7", dias: true },
  { valor: "15", etiqueta: "15", dias: true },
  { valor: "30", etiqueta: "30", dias: true },
  { valor: "45", etiqueta: "45", dias: true },
  { valor: "60", etiqueta: "60", dias: true, ultimoDias: true },
  { valor: "", etiqueta: "Sin plazo fijo" },
];

export function CondicionesPago({ filas, hoy }: { filas: FilaProveedor[]; hoy: string }) {
  const conDeuda = filas.filter((f) => f.comprobantes > 0);
  const faltan = conDeuda.filter((f) => f.condicion.estado === "sin-cargar");

  return (
    <div className="cond">
      {conDeuda.length > 0 && (
        <p className="cond-avance">
          {faltan.length === 0 ? (
            <>
              <strong>Listo.</strong> Los {conDeuda.length} proveedores a los que se les debe algo
              tienen su plazo cargado.
            </>
          ) : (
            <>
              Faltan <strong>{faltan.length}</strong> de {conDeuda.length} proveedores con deuda.
              Los de arriba son los que más plata mueven.
            </>
          )}
        </p>
      )}

      {filas.length === 0 ? (
        <div className="cond-vacio">
          <h2>Todavía no hay proveedores</h2>
          <p>
            Aparecen solos cuando entran comprobantes: cuando alguien saca una foto de una factura
            en Recepción, o cuando se importa el archivo de ARCA desde Importar.
          </p>
        </div>
      ) : (
        <ul className="cond-lista">
          {filas.map((f) => (
            <Fila key={f.id} f={f} hoy={hoy} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Fila({ f, hoy }: { f: FilaProveedor; hoy: string }) {
  const router = useRouter();
  const [guardando, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [otro, setOtro] = useState(false);
  /** Una fila ya cargada se muestra en una línea. Se abre para cambiarla. */
  const [abierto, setAbierto] = useState(false);

  // En una constante, no leída de `f` cada vez: TypeScript pierde el
  // estrechamiento de la unión adentro de un callback, y además se lee mejor.
  const cond = f.condicion;
  const elegido =
    cond.estado === "sin-cargar" ? null : cond.estado === "sin-plazo" ? "" : String(cond.dias);

  function guardar(dias: string) {
    setError(null);
    empezar(async () => {
      const r = await acordarCondicion(f.id, dias);
      if (!r.ok) setError(r.error);
      else {
        setOtro(false);
        setAbierto(false);
        router.refresh();
      }
    });
  }

  function borrar() {
    setError(null);
    empezar(async () => {
      const r = await olvidarCondicion(f.id);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  const sinCargar = cond.estado === "sin-cargar";
  // ¿Está el plazo elegido entre los botones, o es un número suelto?
  const esOtro = cond.estado === "dias" && !PLAZOS.some((p) => p.valor === String(cond.dias));

  const compacta = !sinCargar && !abierto;

  if (compacta) {
    return (
      <li className="cond-fila cond-hecha">
        <div className="cond-quien">
          <span className="cond-nombre">{f.nombre}</span>
          <span className="cond-plata">
            {f.comprobantes === 0 ? (
              <span className="cond-sindeuda">sin deuda hoy</span>
            ) : (
              <>
                {f.deuda} · {f.comprobantes} comprobante{f.comprobantes === 1 ? "" : "s"}
                {f.sinImporte > 0 && (
                  <span className="cond-incompleto"> · faltan {f.sinImporte} sin importe</span>
                )}
              </>
            )}
          </span>
        </div>
        <div className="cond-resuelto">
          <span className="cond-chip">{etiquetaDe(cond)}</span>
          <button type="button" className="cond-cambiar" onClick={() => setAbierto(true)}>
            cambiar
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="cond-fila">
      <div className="cond-quien">
        <span className="cond-nombre">{f.nombre}</span>
        <span className="cond-plata">
          {f.comprobantes === 0 ? (
            <span className="cond-sindeuda">sin deuda hoy</span>
          ) : (
            <>
              {f.deuda} · {f.comprobantes} comprobante{f.comprobantes === 1 ? "" : "s"}
              {/* Un comprobante sin importe NO es un importe de cero: el total
                  se queda corto y se lee como "no debe nada". */}
              {f.sinImporte > 0 && (
                <span className="cond-incompleto"> · faltan {f.sinImporte} sin importe</span>
              )}
              {f.masVieja && <> · la más vieja del {aDiaCorto(f.masVieja)}</>}
            </>
          )}
        </span>
      </div>

      <div className="cond-opciones" role="group" aria-label={`Plazo de pago de ${f.nombre}`}>
        {PLAZOS.map((p) => (
          <Fragment key={p.etiqueta}>
            <button
              type="button"
              className={elegido === p.valor && !esOtro ? "cond-op cond-op-on" : "cond-op"}
              aria-pressed={elegido === p.valor && !esOtro}
              disabled={guardando}
              onClick={() => guardar(p.valor)}
            >
              {p.etiqueta}
              {/* En el teléfono la palabra se esconde y quedan los números
                  solos: repetir "días" cinco veces por tarjeta es la diferencia
                  entre dos renglones y tres, con cincuenta y seis proveedores
                  por delante.
                  **Menos en el último**, que la conserva: así la unidad aparece
                  una vez y va adentro del botón, donde no puede quedar
                  huérfana al principio del renglón siguiente — que es lo que
                  pasó cuando era un texto suelto, y se leía como etiqueta de
                  "Sin plazo fijo". */}
              {p.dias && (
                <span className={p.ultimoDias ? "cond-dias cond-dias-ultimo" : "cond-dias"}>
                  {" "}
                  días
                </span>
              )}
            </button>
          </Fragment>
        ))}
        {esOtro && cond.estado === "dias" && (
          <span className="cond-op cond-op-on">{cond.dias} días</span>
        )}
        {otro ? (
          <OtroPlazo onGuardar={guardar} onCancelar={() => setOtro(false)} disabled={guardando} />
        ) : (
          <button type="button" className="cond-op cond-otro" onClick={() => setOtro(true)}>
            Otro…
          </button>
        )}
      </div>

      {/* Lo que el plazo elegido significa para este proveedor, calculado con
          su factura más vieja. Es lo que hace notar en el momento que el
          número está mal: "60 días" al lado de una factura de julio dice
          enseguida que algo no cierra. */}
      {cond.estado === "dias" && f.masVieja && (
        <p className="cond-efecto">{efectoDe(f.masVieja, cond.dias, hoy)}</p>
      )}
      {cond.estado === "sin-plazo" && f.comprobantes > 0 && (
        <p className="cond-efecto">
          Sin fecha calculada. Se ordena por antigüedad: la más vieja espera desde el{" "}
          {f.masVieja ? aDiaCorto(f.masVieja) : "—"}.
        </p>
      )}

      {!sinCargar && (
        <p className="cond-firma">
          {f.acordadaPor ? `Lo cargó ${f.acordadaPor}` : "Cargado"}
          {f.acordadaAt ? ` el ${aDiaCorto(f.acordadaAt)}` : ""}
          {" · "}
          <button type="button" className="cond-borrar" onClick={borrar} disabled={guardando}>
            borrar
          </button>
        </p>
      )}

      {error && <p className="cond-error">{error}</p>}
    </li>
  );
}

/** El plazo que no está entre los botones. Aparece sólo si lo piden: un campo
 *  numérico siempre visible invita a tipear donde alcanzaba con tocar. */
function OtroPlazo({
  onGuardar,
  onCancelar,
  disabled,
}: {
  onGuardar: (dias: string) => void;
  onCancelar: () => void;
  disabled: boolean;
}) {
  const [valor, setValor] = useState("");
  return (
    <span className="cond-otro-campo">
      <input
        type="number"
        min={0}
        max={365}
        inputMode="numeric"
        value={valor}
        autoFocus
        placeholder="días"
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && valor.trim() !== "") onGuardar(valor.trim());
          if (e.key === "Escape") onCancelar();
        }}
      />
      <button
        type="button"
        className="cond-op"
        disabled={disabled || valor.trim() === ""}
        onClick={() => onGuardar(valor.trim())}
      >
        Guardar
      </button>
      <button type="button" className="cond-op" onClick={onCancelar}>
        Cancelar
      </button>
    </span>
  );
}

/** Cómo se lee una condición en una línea. */
function etiquetaDe(c: Condicion): string {
  if (c.estado === "sin-plazo") return "Sin plazo fijo";
  if (c.estado === "dias") return c.dias === 0 ? "Contado" : `${c.dias} días`;
  return "";
}

/** Qué le pasaría a la factura más vieja con el plazo elegido. */
function efectoDe(masVieja: string, dias: number, hoy: string): string {
  const vence = sumarDias(masVieja, dias);
  if (vence < hoy) {
    const atraso = diasEntre(vence, hoy);
    return `La más vieja habría vencido el ${aDiaCorto(vence)}: ${atraso} día${atraso === 1 ? "" : "s"} de atraso.`;
  }
  if (vence === hoy) return "La más vieja vence hoy.";
  const faltan = diasEntre(hoy, vence);
  return `La más vieja vence el ${aDiaCorto(vence)}, en ${faltan} día${faltan === 1 ? "" : "s"}.`;
}

function diasEntre(a: string, b: string): number {
  const t = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, dd);
  };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/** "2026-08-12" → "12/08". El año se omite: todo lo que se mira acá es de este
 *  año o del pasado por poco, y el año largo hace la fila más difícil de leer. */
function aDiaCorto(dia: string): string {
  const [, m, d] = dia.split("-");
  return `${d}/${m}`;
}
