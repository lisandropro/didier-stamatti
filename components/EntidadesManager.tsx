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
    setOk("Entidad dada de alta.");
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
    <div className="user-list">
      <form className="users-head" onSubmit={alta}>
        <div className="field">
          <label htmlFor="ent-nombre">Nombre</label>
          <input
            id="ent-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Soluciones para Eventos S.A."
            maxLength={120}
          />
        </div>
        <div className="field">
          <label htmlFor="ent-cuit">CUIT</label>
          <input
            id="ent-cuit"
            value={cuit}
            onChange={(e) => setCuit(e.target.value)}
            placeholder="30-71773748-9"
            inputMode="numeric"
            maxLength={13}
          />
        </div>
        <button className="btn primary" disabled={guardando || !nombre.trim() || !cuit.trim()}>
          {guardando ? "Guardando…" : "Agregar"}
        </button>
      </form>

      {error && <div className="login-error">{error}</div>}
      {ok && <div className="settings-ok">{ok}</div>}

      {filas.length === 0 && (
        <p className="msub">
          Todavía no hay ninguna entidad. Sin al menos una, las facturas entran sin saber de quién
          son.
        </p>
      )}

      {filas.map((e) => (
        <div className="user-row" key={e.id}>
          <div className="user-info">
            <div className="user-name">
              {e.nombre}
              {!e.activa && <span className="chip neutral">inactiva</span>}
            </div>
            <div className="user-email">
              {editando === e.id ? (
                <input
                  defaultValue={conGuiones(e.cuit)}
                  aria-label={`CUIT de ${e.nombre}`}
                  onBlur={(ev) => {
                    const v = ev.target.value;
                    if (v.replace(/\D/g, "") !== e.cuit) cambiar(e.id, { cuit: v });
                    else setEditando(null);
                  }}
                  autoFocus
                />
              ) : (
                <button className="btn ghost" onClick={() => setEditando(e.id)}>
                  {conGuiones(e.cuit)}
                </button>
              )}
            </div>
            <div className="msub">
              {e.comprobantes === 0
                ? "Sin comprobantes todavía"
                : `${e.comprobantes} comprobante${e.comprobantes === 1 ? "" : "s"}`}
            </div>
          </div>
          <div className="user-actions">
            <button className="btn ghost" onClick={() => cambiar(e.id, { activa: !e.activa })}>
              {e.activa ? "Desactivar" : "Activar"}
            </button>
          </div>
        </div>
      ))}

      <p className="msub">
        Desactivar una entidad la saca de la lista al capturar. No borra nada: sus comprobantes
        siguen siendo suyos y se siguen viendo.
      </p>
    </div>
  );
}
