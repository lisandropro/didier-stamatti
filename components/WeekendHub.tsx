"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createWeekend, createEvent, deleteWeekend } from "@/app/actions/weekend";
import { saveWeekendSnapshot, discardWeekendChanges } from "@/app/actions/snapshot";

type EventItem = {
  id: string;
  lugar: string;
  dateLabel: string;
  guests: number;
  responsable: string | null;
  status: string;
  lineCount: number;
};
type HubData = {
  weekends: { id: string; label: string; rangeLabel: string; eventCount: number }[];
  selected: {
    id: string;
    label: string;
    rangeLabel: string;
    isPast: boolean;
    snapshotTakenAt: string | null;
    events: EventItem[];
  } | null;
  alert: {
    overProducts: { name: string; total: number; stock: number }[];
    okCount: number;
    totalReut: number;
  };
};

const IconCal = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>
);
const IconPeople = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /></svg>
);
const IconPerson = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></svg>
);
const IconPlus = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
);
const IconWarn = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
);
const IconCheck = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 6 9 17l-5-5" /></svg>
);
const IconTrash = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 13h9l1-13" /></svg>
);
const IconList = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" strokeWidth="2.6" strokeLinecap="round" /></svg>
);
const IconHistory = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 8v4l3 2" /></svg>
);
const IconUndo = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-1" /></svg>
);

export function WeekendHub({ data }: { data: HubData }) {
  const router = useRouter();
  const [showWeekend, setShowWeekend] = useState(false);
  const [showEvent, setShowEvent] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);

  const { selected, weekends, alert } = data;

  async function updateSnapshot() {
    if (!selected) return;
    setSavingSnapshot(true);
    await saveWeekendSnapshot(selected.id);
    setSavingSnapshot(false);
    router.refresh();
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{selected ? selected.label : "Fin de semana"}</h1>
          <div className="sub">
            {selected
              ? `${selected.rangeLabel} · ${selected.events.length} ${selected.events.length === 1 ? "evento" : "eventos"}`
              : "Creá tu primer fin de semana para empezar"}
          </div>
        </div>
        <div className="spacer" />
        {weekends.length > 1 && selected && (
          <select
            className="wk-select"
            value={selected.id}
            onChange={(e) => router.push(`/?w=${e.target.value}`)}
            aria-label="Elegir fin de semana"
          >
            {weekends.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label} ({w.eventCount})
              </option>
            ))}
          </select>
        )}
        <button className="btn ghost" onClick={() => setShowWeekend(true)}>
          {IconPlus} Nuevo fin de semana
        </button>
        {selected && (
          <button className="btn primary" onClick={() => setShowEvent(true)}>
            {IconPlus} Nuevo evento
          </button>
        )}
        {selected && (
          <button className="btn btn-del" onClick={() => setShowDelete(true)} title="Borrar fin de semana">
            {IconTrash} Borrar
          </button>
        )}
      </div>

      <div className="content">
        {selected?.isPast && (
          <div className="snapshot-bar">
            {IconHistory}
            <span>
              Este fin de semana ya pasó · Versión guardada{" "}
              {selected.snapshotTakenAt ? <b>{selected.snapshotTakenAt}</b> : "…"}
            </span>
            <span className="spacer" />
            <button className="btn ghost" onClick={updateSnapshot} disabled={savingSnapshot}>
              {savingSnapshot ? "Guardando…" : "Actualizar versión"}
            </button>
            <button className="btn btn-del" onClick={() => setShowDiscard(true)}>
              {IconUndo} Descartar cambios
            </button>
          </div>
        )}
        {!selected ? (
          <div className="empty-card">
            <p className="empty-title">Todavía no hay fines de semana</p>
            <p>Creá un fin de semana y empezá a cargar sus eventos y pedidos.</p>
            <button className="btn primary" onClick={() => setShowWeekend(true)}>
              {IconPlus} Crear fin de semana
            </button>
          </div>
        ) : (
          <>
            <div className="tiles">
              <div className="tile">
                <div className="k"><span className="dot" style={{ background: "var(--ink)" }} />Eventos</div>
                <div className="v">{selected.events.length}</div>
              </div>
              <div className="tile">
                <div className="k"><span className="dot" style={{ background: "var(--ok)" }} />Productos que alcanzan</div>
                <div className="v">{alert.okCount}<small> / {alert.totalReut}</small></div>
              </div>
              <div className="tile">
                <div className="k"><span className="dot" style={{ background: "var(--crit)" }} />Sin stock suficiente</div>
                <div className="v" style={{ color: alert.overProducts.length ? "var(--crit)" : "var(--ink)" }}>
                  {alert.overProducts.length}
                </div>
              </div>
            </div>

            {alert.overProducts.length > 0 ? (
              <div className="banner crit">
                {IconWarn}
                <div>
                  <b>Sumando todos los eventos, {alert.overProducts.length} producto{alert.overProducts.length > 1 ? "s se pasan" : " se pasa"} del stock</b>
                  <p>
                    {alert.overProducts.slice(0, 3).map((p) => `${p.name} (faltan ${p.total - p.stock})`).join(" · ")}
                    {alert.overProducts.length > 3 ? ` y ${alert.overProducts.length - 3} más` : ""}. Podés generar los pedidos igual — es solo un aviso.
                  </p>
                </div>
              </div>
            ) : (
              <div className="banner ok">
                {IconCheck}
                <div>
                  <b>Todo alcanza para este fin de semana</b>
                  <p>Ningún producto se pasa del stock disponible.</p>
                </div>
              </div>
            )}

            <div className="section-title">
              Eventos <span className="count-pill">{selected.events.length}</span>
              <span className="spacer" style={{ flex: 1 }} />
              {selected.events.length > 0 && (
                <Link className="btn ghost" href={`/finde/${selected.id}`}>
                  {IconList} Resumen del depósito
                </Link>
              )}
            </div>

            {selected.events.length === 0 ? (
              <div className="empty-card">
                <p className="empty-title">Este fin de semana no tiene eventos todavía</p>
                <button className="btn primary" onClick={() => setShowEvent(true)}>{IconPlus} Agregar evento</button>
              </div>
            ) : (
              <div className="event-grid">
                {selected.events.map((e) => (
                  <Link key={e.id} href={`/evento/${e.id}`} className="event">
                    <div className="row1">
                      <h3>{e.lugar}</h3>
                      {e.status === "LISTO" ? (
                        <span className="chip ok">{IconCheck}Listo</span>
                      ) : (
                        <span className="chip neutral">No listo</span>
                      )}
                    </div>
                    <div className="meta">
                      <span className="metaicon">{IconCal}<b>{e.dateLabel}</b></span>
                      <span className="metaicon">{IconPeople}<b>{e.guests}</b> invitados</span>
                      {e.responsable && <span className="metaicon">{IconPerson}{e.responsable}</span>}
                    </div>
                    <div className="event-foot">
                      {e.lineCount > 0 ? `${e.lineCount} producto${e.lineCount > 1 ? "s" : ""} en el pedido` : "Pedido vacío"} · Armar pedido →
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showWeekend && (
        <NewWeekendModal
          onClose={() => setShowWeekend(false)}
          onCreated={(id) => {
            setShowWeekend(false);
            router.push(`/?w=${id}`);
            router.refresh();
          }}
        />
      )}
      {showEvent && selected && (
        <NewEventModal
          weekendId={selected.id}
          onClose={() => setShowEvent(false)}
          onCreated={() => {
            setShowEvent(false);
            router.refresh();
          }}
        />
      )}
      {showDelete && selected && (
        <ConfirmDeleteWeekend
          id={selected.id}
          label={selected.label}
          eventCount={selected.events.length}
          onClose={() => setShowDelete(false)}
          onDeleted={() => {
            setShowDelete(false);
            router.push("/");
            router.refresh();
          }}
        />
      )}
      {showDiscard && selected && (
        <ConfirmDiscardChanges
          id={selected.id}
          label={selected.label}
          takenAt={selected.snapshotTakenAt}
          onClose={() => setShowDiscard(false)}
          onDiscarded={() => {
            setShowDiscard(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function ConfirmDiscardChanges({
  id,
  label,
  takenAt,
  onClose,
  onDiscarded,
}: {
  id: string;
  label: string;
  takenAt: string | null;
  onClose: () => void;
  onDiscarded: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setSaving(true);
    setError(null);
    const res = await discardWeekendChanges(id);
    setSaving(false);
    if (res.ok) onDiscarded();
    else setError(res.error ?? "No se pudo descartar los cambios.");
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>¿Descartar cambios?</h2>
        <div className="msub">
          Los pedidos de <b>{label}</b> van a volver a como estaban en la versión guardada
          {takenAt ? <> del <b>{takenAt}</b></> : ""}. Se pierden las cantidades y notas cargadas después de esa versión.
          No se borran ni el fin de semana ni los eventos, solo los pedidos.
        </div>
        {error && <div className="preview-line" style={{ color: "var(--crit)" }}>{error}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn danger" onClick={confirm} disabled={saving}>
            {saving ? "Descartando…" : "Sí, descartar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteWeekend({
  id,
  label,
  eventCount,
  onClose,
  onDeleted,
}: {
  id: string;
  label: string;
  eventCount: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setSaving(true);
    setError(null);
    const res = await deleteWeekend(id);
    setSaving(false);
    if (res.ok) onDeleted();
    else setError(res.error ?? "No se pudo borrar.");
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>¿Borrar este fin de semana?</h2>
        <div className="msub">
          Se va a borrar <b>{label}</b>
          {eventCount > 0
            ? ` junto con sus ${eventCount} evento${eventCount > 1 ? "s" : ""} y todos sus pedidos`
            : ""}
          . Esta acción no se puede deshacer.
        </div>
        {error && <div className="preview-line" style={{ color: "var(--crit)" }}>{error}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn danger" onClick={confirm} disabled={saving}>
            {saving ? "Borrando…" : "Sí, borrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewWeekendModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [label, setLabel] = useState("");
  const [startDate, setStart] = useState("");
  const [endDate, setEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await createWeekend({ label, startDate, endDate });
    setSaving(false);
    if (res.ok && res.id) onCreated(res.id);
    else setError(res.error ?? "No se pudo crear.");
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Nuevo fin de semana</h2>
        <div className="msub">Elegí las fechas. El nombre es opcional (si lo dejás vacío, uso las fechas).</div>
        <div className="field">
          <label>Nombre (opcional)</label>
          <input type="text" placeholder="Ej: Finde largo de julio" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Desde</label>
            <input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} autoFocus />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Hasta</label>
            <input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        {error && <div className="preview-line" style={{ color: "var(--crit)" }}>{error}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={save} disabled={saving || !startDate || !endDate}>
            {saving ? "Creando…" : "Crear"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewEventModal({ weekendId, onClose, onCreated }: { weekendId: string; onClose: () => void; onCreated: () => void }) {
  const [lugar, setLugar] = useState("");
  const [date, setDate] = useState("");
  const [guests, setGuests] = useState("");
  const [responsable, setResponsable] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await createEvent({
      weekendId,
      lugar,
      date,
      guests: guests.trim() === "" ? 0 : Number(guests),
      responsable,
    });
    setSaving(false);
    if (res.ok) onCreated();
    else setError(res.error ?? "No se pudo crear.");
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Nuevo evento</h2>
        <div className="msub">Cargá los datos del evento del fin de semana.</div>
        <div className="field">
          <label>Lugar</label>
          <input type="text" placeholder="Ej: Puerto, Salón Roble…" value={lugar} onChange={(e) => setLugar(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Fecha y hora</label>
          <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Invitados</label>
            <input type="number" inputMode="numeric" min={0} placeholder="0" value={guests} onChange={(e) => setGuests(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1.4 }}>
            <label>Responsable</label>
            <input type="text" placeholder="Nombre" value={responsable} onChange={(e) => setResponsable(e.target.value)} />
          </div>
        </div>
        {error && <div className="preview-line" style={{ color: "var(--crit)" }}>{error}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={save} disabled={saving || !lugar.trim() || !date}>
            {saving ? "Creando…" : "Crear evento"}
          </button>
        </div>
      </div>
    </div>
  );
}
