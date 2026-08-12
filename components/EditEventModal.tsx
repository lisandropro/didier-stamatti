"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateEvent } from "@/app/actions/period";

/**
 * Corregir el nombre, la fecha y los invitados de un evento que ya tiene el
 * pedido cargado.
 *
 * Dos pasos a propósito: primero se edita, después se muestra **qué va a
 * cambiar** y recién ahí se guarda. Cambiar la fecha puede mudar el evento a
 * otro período, y eso mueve de lugar lo que cuenta contra el stock de
 * cada uno: no es algo para que pase sin que la persona lo haya leído.
 *
 * El pedido no se toca. Las líneas cuelgan del evento, no de su nombre ni de su
 * fecha, así que corregir el encabezado no las mueve.
 */
export function EditEventModal({
  evento,
  onClose,
  onSaved,
}: {
  evento: { id: string; lugar: string; dateLocal: string; guests: number; periodoLabel: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [lugar, setLugar] = useState(evento.lugar);
  const [date, setDate] = useState(evento.dateLocal);
  const [guests, setGuests] = useState(String(evento.guests));
  const [confirmando, setConfirmando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cuando la fecha nueva no cae en ningún finde existente.
  const [faltaPeriodo, setFaltaPeriodo] = useState<{ label: string } | null>(null);
  const [elegir, setElegir] = useState<{ id: string; nombre: string; rango: string }[] | null>(null);

  const invitados = Math.max(0, Math.round(Number(guests) || 0));
  const cambios: { campo: string; antes: string; ahora: string }[] = [];
  if (lugar.trim() && lugar.trim() !== evento.lugar) {
    cambios.push({ campo: "Nombre", antes: evento.lugar, ahora: lugar.trim() });
  }
  if (date && date !== evento.dateLocal) {
    cambios.push({ campo: "Fecha", antes: bonita(evento.dateLocal), ahora: bonita(date) });
  }
  if (invitados !== evento.guests) {
    cambios.push({ campo: "Invitados", antes: String(evento.guests), ahora: String(invitados) });
  }

  async function guardar(opciones: { crearPeriodo?: boolean; periodoElegidoId?: string } = {}) {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    const r = await updateEvent({ eventId: evento.id, lugar, date, guests: invitados, ...opciones });
    setGuardando(false);

    if (r.elegirPeriodo) return setElegir(r.elegirPeriodo);
    if (r.faltaPeriodo) return setFaltaPeriodo({ label: r.faltaPeriodo.label });
    if (!r.ok) {
      setError(r.error ?? "No se pudo guardar.");
      setFaltaPeriodo(null);
      return;
    }
    router.refresh();
    onSaved();
  }

  // --- Falta el período: se pide permiso para crearlo -------------------
  if (faltaPeriodo) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Falta el período de esa fecha</h2>
          <div className="msub">
            Ningún período incluye la fecha nueva. Se puede crear <b>{faltaPeriodo.label}</b> y mover el evento
            ahí, con su pedido entero.
          </div>
          {error && <div className="login-error">{error}</div>}
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setFaltaPeriodo(null)} disabled={guardando}>
              Volver
            </button>
            <button className="btn primary" onClick={() => guardar({ crearPeriodo: true })} disabled={guardando}>
              {guardando ? "Guardando…" : "Crear y mover"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Varios períodos cubren la fecha: elige la persona ----------------------
  if (elegir) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>¿A qué período va?</h2>
          <div className="msub">
            Hay más de un período que incluye esa fecha. Elegí cuál corresponde: de eso depende contra qué stock
            se cuenta el pedido.
          </div>
          <div className="sug-list">
            {elegir.map((p) => (
              <button
                key={p.id}
                className="sug-row"
                disabled={guardando}
                onClick={() => guardar({ periodoElegidoId: p.id })}
              >
                <span className="sug-row-title">{p.nombre}</span>
                <span className="sug-row-meta">{p.rango}</span>
              </button>
            ))}
          </div>
          {error && <div className="login-error">{error}</div>}
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setElegir(null)} disabled={guardando}>
              Volver
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Paso 2: qué va a cambiar ----------------------------------------------
  if (confirmando) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>¿Guardamos estos cambios?</h2>
          <div className="msub">El pedido no se toca: las cantidades y las notas quedan como están.</div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Qué</th>
                  <th>Antes</th>
                  <th>Ahora</th>
                </tr>
              </thead>
              <tbody>
                {cambios.map((c) => (
                  <tr key={c.campo}>
                    <td className="prod">{c.campo}</td>
                    <td className="dim">{c.antes}</td>
                    <td>
                      <span className="stocknum">{c.ahora}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <div className="login-error">{error}</div>}
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setConfirmando(false)} disabled={guardando}>
              Volver a editar
            </button>
            <button className="btn primary" onClick={() => guardar()} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Paso 1: editar ---------------------------------------------------------
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Editar evento</h2>
        <div className="msub">
          Corregí los datos del evento. Está en <b>{evento.periodoLabel}</b>; si la fecha nueva cae en otro
          período, se muda con todo su pedido.
        </div>
        <div className="field">
          <label htmlFor="ev-lugar">Lugar</label>
          <input
            id="ev-lugar"
            type="text"
            value={lugar}
            maxLength={80}
            autoFocus
            onChange={(e) => setLugar(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ev-fecha">Fecha y hora</label>
          <input id="ev-fecha" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ev-invitados">Invitados</label>
          <input
            id="ev-invitados"
            type="number"
            inputMode="numeric"
            min={0}
            value={guests}
            onChange={(e) => setGuests(e.target.value)}
          />
        </div>
        {error && <div className="login-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={cambios.length === 0 || !lugar.trim() || !date}
            onClick={() => {
              setError(null);
              setConfirmando(true);
            }}
          >
            {cambios.length === 0 ? "Sin cambios" : "Revisar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "2026-08-15T18:00" → "15/8 · 18:00", para el resumen de confirmación. */
function bonita(local: string): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return local;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()}/${d.getMonth() + 1} · ${hh}:${mm}`;
}
