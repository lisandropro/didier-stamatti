"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { crearEntidad, editarEntidad } from "@/app/actions/comprobantes";

// A nombre de quién está cada factura.
//
// **Por qué esta pantalla existe en vez de una constante en el código.** El
// módulo nació con el CUIT de la empresa escrito adentro. Con la UTE de los
// Juegos Suramericanos aparecieron dos contribuyentes, y van a aparecer más.
// Que dar de alta una entidad —o corregir un dígito de un CUIT— dependa de un
// despliegue es exactamente el tipo de atadura que este sistema vino a sacar.
//
// **El CUIT es lo que importa acá, no el nombre.** Es contra el CUIT que se
// compara el `nroDocRec` del QR de AFIP para asignar la factura sola. Uno mal
// tipeado no da un error visible: da facturas que nunca encuentran su entidad y
// quedan sueltas. Por eso se valida el dígito verificador antes de guardar y
// por eso se muestra cuántos comprobantes tiene cada una.

export type EntidadFila = {
  id: string;
  nombre: string;
  cuit: string;
  activa: boolean;
  comprobantes: number;
};

/** `30-71773748-9`. Se muestra con guiones porque así está en el papel, y así
 *  es como alguien lo compara con lo que tiene en la mano. */
function conGuiones(cuit: string): string {
  return cuit.length === 11 ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}` : cuit;
}

export function EntidadesManager({ filas }: { filas: EntidadFila[] }) {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [cuit, setCuit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);

  async function alta(e: React.FormEvent) {
    e.preventDefault();
    if (guardando) return;
    setGuardando(true);
    setError(null);
    setOk(null);
    // El resultado se MIRA. Descartarlo dejaría la pantalla igual que si hubiera
    // andado, y quien la usa se iría convencido de haber dado de alta una
    // entidad que no existe.
    const r = await crearEntidad(nombre, cuit);
    setGuardando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setNombre("");
    setCuit("");
    setOk(`"${nombre.trim()}" quedó cargada.`);
    router.refresh();
  }

  async function cambiar(id: string, cambios: { nombre?: string; cuit?: string; activa?: boolean }) {
    setError(null);
    setOk(null);
    const r = await editarEntidad(id, cambios);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setEditando(null);
    router.refresh();
  }

  return (
    <div className="ent">
      {/* El alta va primero y en su propio bloque: es una acción, no un ítem más
          de la lista. Los tres campos en una línea porque son tres, y apilarlos
          haría que una tarea de quince segundos ocupe media pantalla. */}
      <form className="ent-alta" onSubmit={alta}>
        <div className="field">
          <label htmlFor="ent-nombre">Nombre</label>
          <input
            id="ent-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Soluciones para Eventos S.A."
            maxLength={120}
            autoComplete="off"
          />
        </div>
        <div className="field ent-campo-cuit">
          <label htmlFor="ent-cuit">CUIT</label>
          <input
            id="ent-cuit"
            value={cuit}
            onChange={(e) => setCuit(e.target.value)}
            placeholder="30-71773748-9"
            inputMode="numeric"
            maxLength={13}
            autoComplete="off"
          />
        </div>
        <button className="btn primary" disabled={guardando || !nombre.trim() || !cuit.trim()}>
          {guardando ? "Guardando…" : "Agregar"}
        </button>
      </form>

      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      {ok && (
        <p className="settings-ok" role="status">
          {ok}
        </p>
      )}

      {filas.length === 0 ? (
        // Un vacío que enseña qué hace la pantalla, no que dice "no hay nada".
        <div className="empty-card">
          <p>Todavía no hay ninguna entidad.</p>
          <p className="hint">
            Sin al menos una, los comprobantes entran sin saber de quién son y quedan sueltos en
            la bandeja de Pagos.
          </p>
        </div>
      ) : (
        <ul className="ent-lista">
          {filas.map((e) => (
            <li key={e.id} className={e.activa ? undefined : "ent-inactiva"}>
              <div className="ent-datos">
                <span className="ent-nombre">
                  {e.nombre}
                  {!e.activa && <span className="chip neutral">inactiva</span>}
                </span>

                <span className="ent-meta">
                  {editando === e.id ? (
                    <input
                      className="ent-cuit-input"
                      defaultValue={conGuiones(e.cuit)}
                      aria-label={`CUIT de ${e.nombre}`}
                      inputMode="numeric"
                      maxLength={13}
                      autoFocus
                      onKeyDown={(ev) => {
                        if (ev.key === "Escape") setEditando(null);
                        if (ev.key === "Enter") ev.currentTarget.blur();
                      }}
                      onBlur={(ev) => {
                        const v = ev.target.value;
                        if (v.replace(/\D/g, "") !== e.cuit) cambiar(e.id, { cuit: v });
                        else setEditando(null);
                      }}
                    />
                  ) : (
                    // Editable y que se vea que lo es. El caso real es haber
                    // tipeado mal un dígito, y un CUIT equivocado no da error:
                    // da facturas que nunca encuentran su entidad.
                    <button
                      type="button"
                      className="ent-cuit"
                      onClick={() => setEditando(e.id)}
                      title="Corregir el CUIT"
                    >
                      {conGuiones(e.cuit)}
                    </button>
                  )}
                  <span className="ent-cuenta">
                    {e.comprobantes === 0
                      ? "sin comprobantes"
                      : `${e.comprobantes} comprobante${e.comprobantes === 1 ? "" : "s"}`}
                  </span>
                </span>
              </div>

              <button className="btn ghost" onClick={() => cambiar(e.id, { activa: !e.activa })}>
                {e.activa ? "Desactivar" : "Activar"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="ent-nota">
        Desactivar una entidad la saca de la lista al capturar. No borra nada: sus comprobantes
        siguen siendo suyos y se siguen viendo.
      </p>
    </div>
  );
}
