"use client";

import { useState } from "react";
import { updatePeriod } from "@/app/actions/period";

/**
 * Editar las fechas y el nombre de un período operativo.
 *
 * Achicar el rango puede dejar eventos afuera, y un evento colgado de un período
 * que no cubre su fecha cuenta contra el stock del grupo equivocado — algo que no
 * se nota hasta el día del evento. Por eso el servidor no guarda en ese caso:
 * acá se muestra cuáles quedarían afuera y se ofrece el rango mínimo que sí los
 * contiene, en vez de dejar a la persona adivinando qué fecha poner.
 */
export function EditPeriodModal({
  periodo,
  onClose,
  onSaved,
}: {
  periodo: { id: string; labelPropio: string; startDay: string; endDay: string; rangeLabel: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(periodo.labelPropio);
  const [startDay, setStart] = useState(periodo.startDay);
  const [endDay, setEnd] = useState(periodo.endDay);
  const [unSoloDia, setUnSoloDia] = useState(periodo.startDay === periodo.endDay);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState<{ nombre: string } | null>(null);
  const [fuera, setFuera] = useState<{
    eventos: { id: string; lugar: string; dia: string }[];
    sugerido: { startDay: string; endDay: string; label: string };
  } | null>(null);

  const hasta = unSoloDia ? startDay : endDay;
  const huboCambio = label !== periodo.labelPropio || startDay !== periodo.startDay || hasta !== periodo.endDay;

  async function guardar(permitirDuplicado = false) {
    if (saving) return;
    setSaving(true);
    setError(null);
    const r = await updatePeriod({ periodId: periodo.id, label, startDay, endDay: hasta, permitirDuplicado });
    setSaving(false);
    if (r.duplicado) return setDuplicado({ nombre: r.duplicado.nombre });
    if (r.eventosFuera && r.rangoSugerido) return setFuera({ eventos: r.eventosFuera, sugerido: r.rangoSugerido });
    if (!r.ok) return setError(r.error ?? "No se pudo guardar.");
    onSaved();
  }

  // --- Achicar dejaría eventos afuera ----------------------------------------
  if (fuera) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Así quedan eventos afuera</h2>
          <div className="msub">
            Con esas fechas, {fuera.eventos.length === 1 ? "este evento queda" : "estos eventos quedan"} fuera del
            período, y su pedido contaría contra el stock equivocado:
          </div>
          <div className="sug-list">
            {fuera.eventos.map((e) => (
              <div key={e.id} className="sug-row" style={{ cursor: "default" }}>
                <span className="sug-row-title">{e.lugar}</span>
                <span className="sug-row-meta">{e.dia}</span>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setFuera(null)} disabled={saving}>
              Volver a las fechas
            </button>
            <button
              className="btn primary"
              disabled={saving}
              onClick={() => {
                setStart(fuera.sugerido.startDay);
                setEnd(fuera.sugerido.endDay);
                setUnSoloDia(fuera.sugerido.startDay === fuera.sugerido.endDay);
                setFuera(null);
              }}
            >
              Usar {fuera.sugerido.label}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Ya hay otro con el mismo rango ----------------------------------------
  if (duplicado) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Ya existe uno igual</h2>
          <div className="msub">
            <b>{duplicado.nombre}</b> ya cubre exactamente esas fechas. Podés dejarlo así si de verdad son dos
            grupos distintos de vajilla.
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setDuplicado(null)} disabled={saving}>
              Volver
            </button>
            <button className="btn primary" onClick={() => guardar(true)} disabled={saving}>
              {saving ? "Guardando…" : "Guardar igual"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Editar período</h2>
        <div className="msub">
          Ahora va del <b>{periodo.rangeLabel}</b>. Si lo achicás, te aviso antes de guardar qué eventos
          quedarían afuera.
        </div>
        <div className="field">
          <label htmlFor="per-nombre">Nombre (opcional)</label>
          <input
            id="per-nombre"
            type="text"
            value={label}
            placeholder="Si lo dejás vacío, se muestran las fechas"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="per-desde">Desde</label>
            <input id="per-desde" type="date" value={startDay} onChange={(e) => setStart(e.target.value)} />
          </div>
          {!unSoloDia && (
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="per-hasta">Hasta</label>
              <input id="per-hasta" type="date" value={endDay} onChange={(e) => setEnd(e.target.value)} />
            </div>
          )}
        </div>
        <label className="check-line">
          <input type="checkbox" checked={unSoloDia} onChange={(e) => setUnSoloDia(e.target.checked)} />
          Es un solo día
        </label>
        {error && <div className="login-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            className="btn primary"
            onClick={() => guardar()}
            disabled={saving || !huboCambio || !startDay || !hasta}
          >
            {saving ? "Guardando…" : huboCambio ? "Guardar" : "Sin cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
