"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createPeriod,
  createEvent,
  deletePeriod,
  deleteEvent,
  restorePeriod,
  restoreEvent,
} from "@/app/actions/period";
import { savePeriodSnapshot, discardPeriodChanges, restorePeriodVersion } from "@/app/actions/snapshot";
import { ShortagesModal } from "@/components/ShortagesModal";
import { EditPeriodModal } from "@/components/EditPeriodModal";

type EventItem = {
  id: string;
  lugar: string;
  dateLabel: string;
  guests: number;
  responsable: string | null;
  status: string;
  lineCount: number;
  shortageCount: number;
};
type HubData = {
  periodos: { id: string; label: string; rangeLabel: string; eventCount: number }[];
  selected: {
    id: string;
    label: string;
    /** El nombre propio, vacío si se muestra por el rango. */
    labelPropio: string;
    startDay: string;
    endDay: string;
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
  canManage: boolean;
  /** Puede modificar los pedidos. Cambia el texto de las tarjetas: a quien solo
   *  mira no se le ofrece "armar" nada. */
  canEdit: boolean;
  trash: {
    periodos: { id: string; label: string; rangeLabel: string; eventCount: number; deletedLabel: string }[];
    events: { id: string; lugar: string; dateLabel: string; periodLabel: string; lineCount: number; deletedLabel: string }[];
    versions: { id: string; periodLabel: string; kind: string; lineCount: number; actorName: string; atLabel: string }[];
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
const IconEdit = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const IconUndo = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-1" /></svg>
);

export function PeriodHub({ data }: { data: HubData }) {
  const router = useRouter();
  const [showPeriodo, setShowPeriodo] = useState(false);
  const [showEvent, setShowEvent] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showEditPeriodo, setShowEditPeriodo] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<EventItem | null>(null);
  const [faltantesDe, setFaltantesDe] = useState<EventItem | null>(null);

  const { selected, periodos, alert, trash, canManage, canEdit } = data;
  const trashCount = trash.periodos.length + trash.events.length + trash.versions.length;

  async function updateSnapshot() {
    if (!selected) return;
    setSavingSnapshot(true);
    await savePeriodSnapshot(selected.id);
    setSavingSnapshot(false);
    router.refresh();
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{selected ? selected.label : "Período"}</h1>
          <div className="sub">
            {selected
              ? `${selected.rangeLabel} · ${selected.events.length} ${selected.events.length === 1 ? "evento" : "eventos"}`
              : "Creá tu primer período operativo para empezar"}
          </div>
        </div>
        <div className="spacer" />
        {periodos.length > 1 && selected && (
          <select
            className="wk-select"
            value={selected.id}
            onChange={(e) => router.push(`/?w=${e.target.value}`)}
            aria-label="Elegir período"
          >
            {periodos.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label} ({w.eventCount})
              </option>
            ))}
          </select>
        )}
        {canManage && (
          <button className="btn ghost" onClick={() => setShowPeriodo(true)}>
            {IconPlus} Nuevo período
          </button>
        )}
        {canManage && selected && (
          <button className="btn primary" onClick={() => setShowEvent(true)}>
            {IconPlus} Nuevo evento
          </button>
        )}
        {canManage && trashCount > 0 && (
          <button className="btn ghost" onClick={() => setShowTrash(true)} title="Recuperar algo borrado">
            {IconUndo} Papelera <span className="count-pill">{trashCount}</span>
          </button>
        )}
        {canManage && selected && (
          <button className="btn ghost" onClick={() => setShowEditPeriodo(true)} title="Editar las fechas o el nombre">
            {IconEdit} Editar período
          </button>
        )}
        {canManage && selected && (
          <button className="btn btn-del" onClick={() => setShowDelete(true)} title="Borrar período">
            {IconTrash} Borrar
          </button>
        )}
      </div>

      <div className="content">
        {selected?.isPast && (
          <div className="snapshot-bar">
            {IconHistory}
            <span>
              Este período ya pasó · Versión guardada{" "}
              {selected.snapshotTakenAt ? <b>{selected.snapshotTakenAt}</b> : "…"}
            </span>
            <span className="spacer" />
            {canManage && (
              <>
                <button className="btn ghost" onClick={updateSnapshot} disabled={savingSnapshot}>
                  {savingSnapshot ? "Guardando…" : "Actualizar versión"}
                </button>
                <button className="btn btn-del" onClick={() => setShowDiscard(true)}>
                  {IconUndo} Descartar cambios
                </button>
              </>
            )}
          </div>
        )}
        {!selected ? (
          <div className="empty-card">
            <p className="empty-title">Todavía no hay períodos</p>
            <p>{canManage ? "Creá un período y empezá a cargar sus eventos y pedidos." : "Cuando el equipo cree uno, lo vas a ver acá."}</p>
            {canManage && (
              <button className="btn primary" onClick={() => setShowPeriodo(true)}>
                {IconPlus} Crear período
              </button>
            )}
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
                  <b>Todo alcanza para este período</b>
                  <p>Ningún producto se pasa del stock disponible.</p>
                </div>
              </div>
            )}

            <div className="section-title">
              Eventos <span className="count-pill">{selected.events.length}</span>
              <span className="spacer" style={{ flex: 1 }} />
              {selected.events.length > 0 && (
                <Link className="btn ghost" href={`/periodo/${selected.id}`}>
                  {IconList} Resumen del depósito
                </Link>
              )}
            </div>

            {selected.events.length === 0 ? (
              <div className="empty-card">
                <p className="empty-title">Este período no tiene eventos todavía</p>
                <button className="btn primary" onClick={() => setShowEvent(true)}>{IconPlus} Agregar evento</button>
              </div>
            ) : (
              <div className="event-grid">
                {selected.events.map((e) => (
                  // La tarjeta NO es un enlace: el enlace del título se estira
                  // sobre toda la tarjeta (`.event-link::after`), y así los
                  // botones pueden vivir adentro y tocarse sin abrir el evento.
                  <div key={e.id} className="event">
                    <div className="row1">
                      <h3>
                        <Link className="event-link" href={`/evento/${e.id}`}>{e.lugar}</Link>
                      </h3>
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

                    {/* El aviso ES el botón: un solo elemento en vez de una
                        franja y un botón repitiendo lo mismo. */}
                    {e.shortageCount > 0 && (
                      <button
                        className="event-falta"
                        onClick={() => setFaltantesDe(e)}
                        title={`Ver los faltantes de ${e.lugar}`}
                      >
                        {IconWarn}
                        <span>
                          {e.shortageCount === 1
                            ? "1 producto sin stock suficiente"
                            : `${e.shortageCount} productos sin stock suficiente`}
                        </span>
                        <span className="event-falta-cta"><span>Ver faltantes →</span></span>
                      </button>
                    )}

                    <div className="event-foot">
                      <span>
                        {e.lineCount > 0 ? `${e.lineCount} producto${e.lineCount > 1 ? "s" : ""} en el pedido` : "Pedido vacío"} ·{" "}
                        {canEdit ? "Armar pedido" : "Ver pedido"} →
                      </span>
                      {canManage && (
                        <button
                          className="event-del"
                          onClick={() => setEventToDelete(e)}
                          title={`Borrar el evento de ${e.lugar}`}
                          aria-label={`Borrar el evento de ${e.lugar}`}
                        >
                          {IconTrash}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showPeriodo && (
        <NewPeriodModal
          onClose={() => setShowPeriodo(false)}
          onCreated={(id) => {
            setShowPeriodo(false);
            router.push(`/?w=${id}`);
            router.refresh();
          }}
        />
      )}
      {showEvent && (
        <NewEventModal
          onClose={() => setShowEvent(false)}
          onCreated={() => {
            setShowEvent(false);
            router.refresh();
          }}
        />
      )}
      {showEditPeriodo && selected && (
        <EditPeriodModal
          periodo={selected}
          onClose={() => setShowEditPeriodo(false)}
          onSaved={() => {
            setShowEditPeriodo(false);
            router.refresh();
          }}
        />
      )}
      {showDelete && selected && (
        <ConfirmDeletePeriod
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
          currentLines={selected.events.reduce((n, e) => n + e.lineCount, 0)}
          eventCount={selected.events.length}
          onClose={() => setShowDiscard(false)}
          onDiscarded={() => {
            setShowDiscard(false);
            router.refresh();
          }}
        />
      )}
      {eventToDelete && (
        <ConfirmDeleteEvent
          event={eventToDelete}
          onClose={() => setEventToDelete(null)}
          onDeleted={() => {
            setEventToDelete(null);
            router.refresh();
          }}
        />
      )}
      {faltantesDe && (
        <ShortagesModal
          eventId={faltantesDe.id}
          lugar={faltantesDe.lugar}
          onClose={() => setFaltantesDe(null)}
        />
      )}
      {showTrash && (
        <TrashModal
          trash={trash}
          onClose={() => setShowTrash(false)}
          onRestored={(periodId) => {
            setShowTrash(false);
            if (periodId) router.push(`/?w=${periodId}`);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function ConfirmDeleteEvent({
  event,
  onClose,
  onDeleted,
}: {
  event: EventItem;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setSaving(true);
    setErr(null);
    const res = await deleteEvent(event.id);
    setSaving(false);
    if (!res.ok) return setErr(res.error ?? "No se pudo borrar.");
    onDeleted();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()}>
        <h2>¿Borrar el evento de {event.lugar}?</h2>
        <p className="modal-sub">
          {event.lineCount > 0
            ? `Se va a la papelera junto con sus ${event.lineCount} producto${event.lineCount > 1 ? "s" : ""} del pedido.`
            : "Todavía no tiene pedido cargado."}{" "}
          El resto del período no se toca, y lo podés recuperar desde la papelera.
        </p>
        {err && <div className="form-error">{err}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn danger" onClick={confirm} disabled={saving}>
            {saving ? "Borrando…" : "Borrar evento"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TrashModal({
  trash,
  onClose,
  onRestored,
}: {
  trash: HubData["trash"];
  onClose: () => void;
  onRestored: (periodId?: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function recuperar(kind: "period" | "event" | "version", id: string) {
    setBusy(id);
    setErr(null);
    // Recuperar un finde o un evento lleva al finde recuperado; restaurar una
    // versión de pedidos deja donde estás, porque el finde no se movió.
    if (kind === "version") {
      const res = await restorePeriodVersion(id);
      setBusy(null);
      if (!res.ok) return setErr(res.error ?? "No se pudo restaurar.");
      return onRestored();
    }
    const res = kind === "period" ? await restorePeriod(id) : await restoreEvent(id);
    setBusy(null);
    if (!res.ok) return setErr(res.error ?? "No se pudo recuperar.");
    onRestored(res.id);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(ev) => ev.stopPropagation()}>
        <h2>Papelera</h2>
        <p className="modal-sub">
Nada se borra del todo. Recuperá lo que necesites y vuelve con sus pedidos como estaban.
        </p>
        {err && <div className="form-error">{err}</div>}

        <div className="trash-list">
          {trash.periodos.map((w) => (
            <div className="trash-item" key={w.id}>
              <div>
                <b>{w.label}</b>
                <div className="trash-meta">
                  Período · {w.rangeLabel} · {w.eventCount} {w.eventCount === 1 ? "evento" : "eventos"} · borrado el {w.deletedLabel}
                </div>
              </div>
              <button className="btn ghost" onClick={() => recuperar("period", w.id)} disabled={busy === w.id}>
                {IconUndo} {busy === w.id ? "Recuperando…" : "Recuperar"}
              </button>
            </div>
          ))}
          {trash.events.map((e) => (
            <div className="trash-item" key={e.id}>
              <div>
                <b>{e.lugar}</b>
                <div className="trash-meta">
                  Evento de {e.periodLabel} · {e.dateLabel} ·{" "}
                  {e.lineCount > 0 ? `${e.lineCount} producto${e.lineCount > 1 ? "s" : ""}` : "sin pedido"} · borrado el {e.deletedLabel}
                </div>
              </div>
              <button className="btn ghost" onClick={() => recuperar("event", e.id)} disabled={busy === e.id}>
                {IconUndo} {busy === e.id ? "Recuperando…" : "Recuperar"}
              </button>
            </div>
          ))}
          {trash.versions.map((v) => (
            <div className="trash-item" key={v.id}>
              <div>
                <b>Pedidos de {v.periodLabel}</b>
                <div className="trash-meta">
                  {v.kind === "PRE_DESCARTE" ? "Antes de descartar cambios" : "Antes de restaurar otra versión"} ·{" "}
                  {v.lineCount} {v.lineCount === 1 ? "producto" : "productos"} · {v.actorName} · {v.atLabel}
                </div>
              </div>
              <button className="btn ghost" onClick={() => recuperar("version", v.id)} disabled={busy === v.id}>
                {IconUndo} {busy === v.id ? "Restaurando…" : "Restaurar"}
              </button>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDiscardChanges({
  id,
  label,
  takenAt,
  currentLines,
  eventCount,
  onClose,
  onDiscarded,
}: {
  id: string;
  label: string;
  takenAt: string | null;
  currentLines: number;
  eventCount: number;
  onClose: () => void;
  onDiscarded: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setSaving(true);
    setError(null);
    const res = await discardPeriodChanges(id);
    setSaving(false);
    if (res.ok) onDiscarded();
    else setError(res.error ?? "No se pudo descartar los cambios.");
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>¿Descartar cambios?</h2>
        <div className="msub">
          <p>
            Los pedidos de <b>{label}</b> vuelven a como estaban en la versión guardada
            {takenAt ? <> del <b>{takenAt}</b></> : ""}.
          </p>
          <p>
            <b>Qué se reemplaza:</b> los {currentLines} {currentLines === 1 ? "producto cargado" : "productos cargados"} hoy
            en {eventCount === 1 ? "el evento" : `los ${eventCount} eventos`} de este período, con sus cantidades y
            sus notas.
          </p>
          <p>
            <b>Qué NO se toca:</b> el período, los eventos, el stock del depósito ni el historial de movimientos.
          </p>
        </div>
        <div className="banner ok" style={{ marginBottom: "var(--sp-4)" }}>
          <div>
            <b>Se guarda una copia antes de descartar</b>
            <p>Si te arrepentís, la recuperás entera desde la Papelera.</p>
          </div>
        </div>
        {error && <div className="form-error">{error}</div>}
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

function ConfirmDeletePeriod({
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
    const res = await deletePeriod(id);
    setSaving(false);
    if (res.ok) onDeleted();
    else setError(res.error ?? "No se pudo borrar.");
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>¿Borrar este período?</h2>
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

function NewPeriodModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [label, setLabel] = useState("");
  const [startDay, setStart] = useState("");
  const [endDay, setEnd] = useState("");
  const [unSoloDia, setUnSoloDia] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState<{ nombre: string } | null>(null);

  const hasta = unSoloDia ? startDay : endDay;

  async function save(permitirDuplicado = false) {
    setSaving(true);
    setError(null);
    const res = await createPeriod({ label, startDay, endDay: hasta, permitirDuplicado });
    setSaving(false);
    if (res.duplicado) return setDuplicado({ nombre: res.duplicado.nombre });
    if (res.ok && res.id) onCreated(res.id);
    else setError(res.error ?? "No se pudo crear.");
  }

  if (duplicado) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Ya existe uno igual</h2>
          <div className="msub">
            <b>{duplicado.nombre}</b> ya cubre exactamente esas fechas. Podés usar ese, o crear otro igual si de
            verdad son dos grupos distintos de vajilla.
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={onClose} disabled={saving}>Usar el que existe</button>
            <button className="btn primary" onClick={() => save(true)} disabled={saving}>
              {saving ? "Creando…" : "Crear otro igual"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Nuevo período operativo</h2>
        <div className="msub">
          Los eventos de un período comparten la misma vajilla. Puede ser una sola jornada o los días que hagan
          falta, cualquier día de la semana.
        </div>
        <div className="field">
          <label>Nombre (opcional)</label>
          <input
            type="text"
            placeholder="Si lo dejás vacío, se muestran las fechas"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Desde</label>
            <input type="date" value={startDay} onChange={(e) => setStart(e.target.value)} autoFocus />
          </div>
          {!unSoloDia && (
            <div className="field" style={{ flex: 1 }}>
              <label>Hasta</label>
              <input type="date" value={endDay} onChange={(e) => setEnd(e.target.value)} />
            </div>
          )}
        </div>
        <label className="check-line">
          <input type="checkbox" checked={unSoloDia} onChange={(e) => setUnSoloDia(e.target.checked)} />
          Es un solo día
        </label>
        {error && <div className="login-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={() => save()} disabled={saving || !startDay || !hasta}>
            {saving ? "Creando…" : "Crear"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewEventModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [lugar, setLugar] = useState("");
  const [date, setDate] = useState("");
  const [guests, setGuests] = useState("");
  const [responsable, setResponsable] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El período no se pide: sale de la fecha, que es el dato que la persona
  // tiene. Solo se pregunta cuando hay más de uno que la cubre, o ninguno.
  const [elegir, setElegir] = useState<{ id: string; nombre: string; rango: string }[] | null>(null);
  const [falta, setFalta] = useState<{ label: string } | null>(null);

  async function save(opciones: { periodoElegidoId?: string; crearPeriodo?: boolean } = {}) {
    setSaving(true);
    setError(null);
    const res = await createEvent({
      lugar,
      date,
      guests: guests.trim() === "" ? 0 : Number(guests),
      responsable,
      ...opciones,
    });
    setSaving(false);
    if (res.elegirPeriodo) return setElegir(res.elegirPeriodo);
    if (res.faltaPeriodo) return setFalta({ label: res.faltaPeriodo.label });
    if (res.ok) onCreated();
    else setError(res.error ?? "No se pudo crear.");
  }

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
              <button key={p.id} className="sug-row" onClick={() => save({ periodoElegidoId: p.id })} disabled={saving}>
                <span className="sug-row-title">{p.nombre}</span>
                <span className="sug-row-meta">{p.rango}</span>
              </button>
            ))}
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setElegir(null)} disabled={saving}>Volver</button>
          </div>
        </div>
      </div>
    );
  }

  if (falta) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Falta el período de esa fecha</h2>
          <div className="msub">
            Ningún período incluye ese día. Se puede crear <b>{falta.label}</b> y poner el evento ahí; después
            podés estirarlo si el trabajo abarca más días.
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setFalta(null)} disabled={saving}>Volver</button>
            <button className="btn primary" onClick={() => save({ crearPeriodo: true })} disabled={saving}>
              {saving ? "Creando…" : "Crear y agregar"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Nuevo evento</h2>
        <div className="msub">Cargá los datos del evento. El período sale de la fecha.</div>
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
          <button className="btn primary" onClick={() => save()} disabled={saving || !lugar.trim() || !date}>
            {saving ? "Creando…" : "Crear evento"}
          </button>
        </div>
      </div>
    </div>
  );
}
