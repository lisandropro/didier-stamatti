"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { completarAMano } from "@/app/actions/comprobantes";

type Inicial = {
  nombreProveedor: string;
  importe: string;
  fechaEmision: string;
  vencimiento: string;
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
            <label className="cmp-campo">
              <span>Proveedor</span>
              <input
                name="nombreProveedor"
                defaultValue={inicial.nombreProveedor}
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
              <label className="cmp-campo">
                <span>Importe total</span>
                <input
                  name="importe"
                  defaultValue={inicial.importe}
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

            <label className="cmp-campo">
              <span>Fecha de emisión</span>
              <input type="date" name="fechaEmision" defaultValue={inicial.fechaEmision} />
            </label>

            {campos.vencimiento && (
              <label className="cmp-campo">
                <span>Vencimiento</span>
                <input type="date" name="vencimiento" defaultValue={inicial.vencimiento} />
                <small>El &quot;Vto:&quot; del papel. No es la fecha del CAE.</small>
              </label>
            )}

            <button type="submit" className="btn primary cmp-guardar" disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
