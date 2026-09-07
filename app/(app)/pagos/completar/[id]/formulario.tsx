"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { completarAMano, leerComprobanteConIA } from "@/app/actions/comprobantes";
import { formatear } from "@/lib/money";

type Inicial = {
  nombreProveedor: string;
  importe: string;
  fechaEmision: string;
  vencimiento: string;
};

type Controles = {
  cierraLaCuenta: boolean | null;
  cierranLosRenglones: boolean | null;
  cuitValido: boolean | null;
};

/**
 * Qué campos pide cada tipo de comprobante.
 *
 * Un remito no lleva importe y ningún papel informal lleva vencimiento.
 * Preguntar de más no es inocuo: la forma más rápida de conseguir que alguien
 * cargue datos falsos es pedirle un campo que el papel que tiene en la mano no
 * tiene, y no dejarlo seguir sin completarlo.
 */
function camposDe(kind: string): { importe: boolean; vencimiento: boolean } {
  if (kind === "REMITO") return { importe: false, vencimiento: false };
  if (kind === "TICKET") return { importe: true, vencimiento: false };
  return { importe: true, vencimiento: true };
}

/** `"1245080"` (centavos) -> `"12450,80"`, que es como se va a editar. */
function aCampo(centavosTexto: string | undefined): string | undefined {
  if (!centavosTexto) return undefined;
  const t = centavosTexto.padStart(3, "0");
  return `${t.slice(0, -2)},${t.slice(-2)}`;
}

export default function FormularioCompletar({
  id,
  kind,
  yaPagado,
  tieneFoto,
  inicial,
  proveedores,
}: {
  id: string;
  kind: string;
  yaPagado: boolean;
  tieneFoto: boolean;
  inicial: Inicial;
  proveedores: string[];
}) {
  const router = useRouter();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState(false);
  const campos = camposDe(kind);

  // Los valores del formulario son controlados para que la lectura pueda
  // proponerlos. `propuestos` es lo que vino del lector y todavía no confirmó
  // nadie: se marca distinto y se limpia en cuanto la persona toca el campo.
  const [valores, setValores] = useState<Inicial>(inicial);
  const [propuestos, setPropuestos] = useState<Set<keyof Inicial>>(new Set());
  const [leyendo, setLeyendo] = useState(false);
  const [controles, setControles] = useState<Controles | null>(null);
  const [avisoLectura, setAvisoLectura] = useState<string | null>(null);

  function escribir(campo: keyof Inicial, valor: string) {
    setValores((v) => ({ ...v, [campo]: valor }));
    // Tocado por una persona: deja de ser una propuesta.
    setPropuestos((p) => {
      if (!p.has(campo)) return p;
      const n = new Set(p);
      n.delete(campo);
      return n;
    });
  }

  async function leer() {
    setLeyendo(true);
    setAvisoLectura(null);
    setControles(null);
    try {
      const r = await leerComprobanteConIA(id);
      if (!r.ok) {
        setAvisoLectura(r.error);
        return;
      }

      // Solo se proponen los campos VACÍOS. Pisar algo que una persona ya
      // escribió sería el único caso en que una lectura probabilística le gana a
      // un dato confirmado, y es exactamente al revés.
      const nuevos = new Set<keyof Inicial>();
      setValores((v) => {
        const sig = { ...v };
        const poner = (campo: keyof Inicial, valor: string | undefined) => {
          if (!valor || sig[campo]) return;
          sig[campo] = valor;
          nuevos.add(campo);
        };
        poner("nombreProveedor", r.campos.nombreProveedor);
        poner("importe", aCampo(r.campos.total));
        poner("fechaEmision", r.campos.fechaEmision);
        poner("vencimiento", r.campos.vencimiento);
        return sig;
      });
      setPropuestos(nuevos);
      setControles(r.controles);

      if (nuevos.size === 0) {
        setAvisoLectura("La lectura no encontró nada nuevo que proponer.");
      } else if (r.campos.condicionPago && !r.campos.vencimiento) {
        // El papel dice un plazo en vez de una fecha. Es un dato real y útil,
        // pero no es un vencimiento: lo tiene que convertir una persona, que es
        // la que sabe desde cuándo se cuenta.
        setAvisoLectura(`El papel dice "${r.campos.condicionPago}" en vez de una fecha de vencimiento.`);
      }
    } catch {
      setAvisoLectura("No se pudo leer la foto. Cargalo a mano.");
    } finally {
      setLeyendo(false);
    }
  }

  async function enviar(fd: FormData) {
    setGuardando(true);
    setError(null);
    setDuplicado(false);
    try {
      const r = await completarAMano(id, fd);
      if (!r.ok) {
        setError(r.error);
        return; // no se navega: los datos tipeados siguen en pantalla
      }
      if (r.posibleDuplicado) {
        // Se guardó igual —dos facturas iguales el mismo mes existen— pero acá,
        // con el papel todavía en la mano, es cuando se puede decidir en dos
        // segundos. En la pantalla de pagos, dos semanas después, ya no.
        setDuplicado(true);
        return;
      }
      router.push("/pagos");
      router.refresh();
    } catch {
      setError("Se cortó la conexión. No se guardó nada: revisá y volvé a intentar.");
    } finally {
      setGuardando(false);
    }
  }

  const marca = (campo: keyof Inicial) => (propuestos.has(campo) ? " cmp-propuesto" : "");
  const hayPropuestas = propuestos.size > 0;

  return (
    <>
      <header className="topbar">
        <h1>Completar comprobante</h1>
        <Link href="/pagos" className="btn ghost">
          Volver
        </Link>
      </header>

      <div className="content">
        {yaPagado && (
          <p className="cmp-pagado" role="status">
            Este comprobante ya está pagado. Podés corregir fechas y proveedor, pero para cambiar el
            importe hay que revertir el pago primero.
          </p>
        )}

        {error && (
          <p className="cmp-error" role="alert">
            {error}
          </p>
        )}

        {duplicado && (
          <div className="cmp-duplicado" role="alert">
            <strong>Se guardó, pero ojo.</strong> Ya hay otro comprobante de este proveedor por el
            mismo importe. Si es el mismo papel cargado dos veces, anulá uno antes de pagar.
            <div className="cmp-duplicado-acciones">
              <Link href="/pagos" className="btn primary">
                Ir a pagos y revisar
              </Link>
              <button type="button" className="btn ghost" onClick={() => setDuplicado(false)}>
                Es otro comprobante, seguir acá
              </button>
            </div>
          </div>
        )}

        <div className="cmp-partido">
          {/* La foto primero en el orden del documento: en el teléfono queda
              arriba del formulario, que es donde hay que mirarla. En escritorio
              la grilla la manda a la izquierda. */}
          <div className="cmp-papel">
            {tieneFoto ? (
              /* eslint-disable-next-line @next/next/no-img-element -- la foto sale
                 de una ruta con permiso por pedido, no de un origen optimizable */
              <img
                src={`/api/comprobantes/${id}/foto`}
                alt="El comprobante que se está completando"
                className="cmp-foto"
              />
            ) : (
              <p className="cmp-sin-foto">Este comprobante no tiene foto.</p>
            )}
          </div>

          <form action={enviar} className="cmp-form">
            {tieneFoto && (
              <button type="button" className="btn ghost cmp-leer" onClick={leer} disabled={leyendo}>
                {leyendo ? "Leyendo la foto…" : "Leer la foto y proponer los campos"}
              </button>
            )}

            {avisoLectura && (
              <p className="cmp-nota" role="status">
                {avisoLectura}
              </p>
            )}

            {hayPropuestas && <Semaforo controles={controles} valores={valores} campos={campos} />}

            <label className={`cmp-campo${marca("nombreProveedor")}`}>
              <span>Proveedor</span>
              <input
                name="nombreProveedor"
                value={valores.nombreProveedor}
                onChange={(e) => escribir("nombreProveedor", e.target.value)}
                list="proveedores-conocidos"
                autoComplete="off"
                placeholder="Como figura en el papel"
                enterKeyHint="next"
              />
              {/* Ofrecer los que ya existen es la mitad barata de no partir la
                  deuda de un proveedor en dos por un acento. La otra mitad la
                  hace el servidor, que compara sin acentos ni mayúsculas. */}
              <datalist id="proveedores-conocidos">
                {proveedores.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </label>

            {campos.importe && (
              <label className={`cmp-campo${marca("importe")}`}>
                <span>Importe total</span>
                <input
                  name="importe"
                  value={valores.importe}
                  onChange={(e) => escribir("importe", e.target.value)}
                  // `inputMode="decimal"` y no `type="number"`: en el teléfono
                  // abre el teclado numérico igual, pero acepta la coma
                  // argentina y no le agrega flechitas de incremento a un campo
                  // donde nadie quiere sumar de a uno.
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="12450,80"
                  disabled={yaPagado}
                />
                <small>Como está impreso, con coma. El total, con IVA.</small>
              </label>
            )}

            <label className={`cmp-campo${marca("fechaEmision")}`}>
              <span>Fecha de emisión</span>
              <input
                type="date"
                name="fechaEmision"
                value={valores.fechaEmision}
                onChange={(e) => escribir("fechaEmision", e.target.value)}
              />
            </label>

            {campos.vencimiento && (
              <label className={`cmp-campo${marca("vencimiento")}`}>
                <span>Vencimiento</span>
                <input
                  type="date"
                  name="vencimiento"
                  value={valores.vencimiento}
                  onChange={(e) => escribir("vencimiento", e.target.value)}
                />
                <small>El &quot;Vto:&quot; del papel. No es la fecha del CAE.</small>
              </label>
            )}

            <button type="submit" className="btn primary cmp-guardar" disabled={guardando}>
              {guardando ? "Guardando…" : hayPropuestas ? "Confirmar y guardar" : "Guardar"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

/**
 * Qué tan confiable es lo que propuso la lectura.
 *
 * Tres estados y no dos. **`null` no se muestra como rojo**: no poder verificar
 * y verificar que está mal son cosas distintas, y pintarlas igual sería mentirle
 * a quien paga — además de gastar la alarma, que es lo que hace que dejen de
 * mirarse.
 *
 * En verde el trabajo es un toque. En rojo se señala qué campo mirar, y es el
 * único momento del flujo en que vale la pena comparar contra el papel.
 */
function Semaforo({
  controles,
  valores,
  campos,
}: {
  controles: Controles | null;
  valores: Inicial;
  campos: { importe: boolean };
}) {
  if (!controles) return null;

  const rojos: string[] = [];
  if (controles.cierraLaCuenta === false) rojos.push("el total no da la suma de sus partes");
  if (controles.cierranLosRenglones === false) rojos.push("los renglones no suman el subtotal");
  if (controles.cuitValido === false) rojos.push("el CUIT no valida");

  const verdes =
    controles.cierraLaCuenta === true ||
    controles.cierranLosRenglones === true ||
    controles.cuitValido === true;

  if (rojos.length > 0) {
    return (
      <div className="cmp-semaforo cmp-semaforo-mal" role="alert">
        <strong>Revisá contra el papel:</strong> {rojos.join(", ")}.
        {campos.importe && valores.importe && <> El importe propuesto es {conSigno(valores.importe)}.</>}
      </div>
    );
  }

  if (verdes) {
    return (
      <div className="cmp-semaforo cmp-semaforo-bien" role="status">
        <strong>Las cuentas cierran.</strong> Mirá que el proveedor sea el correcto y confirmá.
      </div>
    );
  }

  // Todo en null: se leyó, pero no había con qué verificar. Se dice, sin
  // pintarlo de ningún color.
  return (
    <div className="cmp-semaforo cmp-semaforo-neutro" role="status">
      No se pudo verificar la lectura contra nada. Compará el importe con el papel antes de
      confirmar.
    </div>
  );
}

/** `"12450,80"` -> `"$ 12.450,80"`, solo para leerlo en el cartel. */
function conSigno(campo: string): string {
  const centavos = campo.replace(/\./g, "").replace(",", "");
  try {
    return formatear(BigInt(centavos || "0"));
  } catch {
    return campo;
  }
}
