"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { avisarDeFalloAlGuardar, mensajeDeFallo, intentar } from "@/lib/actualizacion";
import { clearDraft, readDraft } from "@/lib/session-draft";
import { useSessionDraft } from "@/components/useSessionDraft";
import {
  createPeriod,
  createEvent,
  deletePeriod,
  restorePeriod,
  restoreEvent,
} from "@/app/actions/period";
import { savePeriodSnapshot, discardPeriodChanges, restorePeriodVersion } from "@/app/actions/snapshot";
import { ShortagesModal } from "@/components/ShortagesModal";
import { EditPeriodModal } from "@/components/EditPeriodModal";
import { RowMenu } from "@/components/RowMenu";
import { Confirmar, Dialogo } from "@/components/Dialogo";
import { Campo, MensajeDeError } from "@/components/Formulario";
import { IconCal, IconCheck, IconEdit, IconHistory, IconList, IconPeople, IconPerson, IconPlus, IconTrash, IconUndo, IconWarn } from "@/components/iconos";
import { sinRueda } from "@/components/util";

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
  userId: string;
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
    /** Los que faltan hacer: es la lista que se ve. */
    events: EventItem[];
    /** Los que ya se hicieron. Se pliegan al pie para que no estorben. */
    pasados: EventItem[];
  } | null;
  alert: {
    overProducts: { name: string; total: number; stock: number }[];
    okCount: number;
    totalReut: number;
    /** Reutilizables que nunca se contaron: de esos no se sabe si alcanzan. */
    sinRecuento: number;
  };
  canManage: boolean;
  /** Puede modificar los pedidos. Cambia el texto de las tarjetas: a quien solo
   *  mira no se le ofrece "armar" nada. */
  canEdit: boolean;
  trash: {
    periodos: { id: string; label: string; rangeLabel: string; eventCount: number; deletedLabel: string }[];
    events: { id: string; lugar: string; dateLabel: string; periodLabel: string; lineCount: number; deletedLabel: string }[];
    versions: { id: string; periodLabel: string; kind: string; lineCount: number; actorName: string; atLabel: string; preparados: number }[];
  };
};

export function PeriodHub({ data }: { data: HubData }) {
  const router = useRouter();
  const periodDraftKey = "new-period:" + data.userId;
  const eventDraftKey = "new-event:" + data.userId;
  const [showPeriodo, setShowPeriodo] = useState(false);
  const [showEvent, setShowEvent] = useState(false);
  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      if (readDraft(periodDraftKey)) setShowPeriodo(true);
      else if (readDraft(eventDraftKey)) setShowEvent(true);
    });
    return () => { alive = false; };
  }, [periodDraftKey, eventDraftKey]);
  const [showDelete, setShowDelete] = useState(false);
  const [showEditPeriodo, setShowEditPeriodo] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  // Al descartar o restaurar, los renglones de un producto que ya se eliminó
  // del catálogo no pueden volver. Se dice cuántos fueron, no se calla.
  const [omitidas, setOmitidas] = useState(0);
  const [faltantesDe, setFaltantesDe] = useState<EventItem | null>(null);

  const { selected, periodos, alert, trash, canManage, canEdit } = data;
  const trashCount = trash.periodos.length + trash.events.length + trash.versions.length;
  // El período tiene todos sus eventos aunque abajo se muestren en dos listas.
  const totalEventos = selected ? selected.events.length + selected.pasados.length : 0;

  // La misma tarjeta para las dos listas, la de lo que falta y la de lo ya hecho.
  // La tarjeta NO es un enlace: el enlace del título se estira sobre toda la
  // tarjeta (`.event-link::after`), y así los botones pueden vivir adentro y
  // tocarse sin abrir el evento.
  const tarjetaDeEvento = (e: EventItem) => (
    <div key={e.id} className="event">
      <div className="row1">
        <h3>
          <Link className="event-link" href={`/evento/${e.id}`}>{e.lugar}</Link>
        </h3>
        {e.status === "LISTO" ? (
          <span className="chip ok">{IconCheck}Listo</span>
        ) : (
          <span className="chip neutral">Borrador</span>
        )}
      </div>
      <div className="meta">
        <span className="metaicon">{IconCal}<b>{e.dateLabel}</b></span>
        <span className="metaicon">{IconPeople}<b>{e.guests}</b> invitados</span>
        {e.responsable && <span className="metaicon">{IconPerson}{e.responsable}</span>}
      </div>

      {/* El aviso ES el botón: un solo elemento en vez de una franja y un
          botón repitiendo lo mismo. */}
      {e.shortageCount > 0 && (
        <button
          type="button"
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
      </div>
    </div>
  );

  async function updateSnapshot() {
    if (!selected) return;
    setSavingSnapshot(true);
    setSnapshotError(null);
    const res = await intentar(() => savePeriodSnapshot(selected.id));
    setSavingSnapshot(false);
    // Si no se guardó, se dice: antes el botón volvía a su lugar como si hubiera andado.
    if (!res.ok) return setSnapshotError(res.error ?? "No se pudo actualizar la versión guardada.");
    router.refresh();
  }

  return (
    <>
      <div className="topbar topbar-hub">
        <div className="topbar-titulo">
          <h1>{selected ? selected.label : "Período"}</h1>
          <div className="sub">
            {selected
              ? `${selected.rangeLabel} · ${totalEventos} ${totalEventos === 1 ? "evento" : "eventos"}`
              : "Creá tu primer período operativo para empezar"}
          </div>
        </div>
        <div className="spacer" />
        {/* En el celular, lo que se usa poco va a un menú: los botones apilados
            empujaban los eventos al final de la primera pantalla. */}
        {canManage && (
          <div className="solo-celular">
            <RowMenu
              grande
              label="Más acciones del período"
              items={[
                { label: "Nuevo período", onSelect: () => setShowPeriodo(true) },
                ...(selected ? [{ label: "Editar período", onSelect: () => setShowEditPeriodo(true) }] : []),
                ...(trashCount > 0 ? [{ label: `Papelera (${trashCount})`, onSelect: () => setShowTrash(true) }] : []),
                ...(selected ? [{ label: "Borrar período", onSelect: () => setShowDelete(true), peligro: true }] : []),
              ]}
            />
          </div>
        )}
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
          <button className="btn ghost solo-ancho" onClick={() => setShowPeriodo(true)}>
            {IconPlus} Nuevo período
          </button>
        )}
        {canManage && selected && (
          <button className="btn primary" onClick={() => setShowEvent(true)}>
            {IconPlus} Nuevo evento
          </button>
        )}
        {canManage && trashCount > 0 && (
          <button className="btn ghost solo-ancho" onClick={() => setShowTrash(true)} title="Recuperar algo borrado">
            {IconUndo} Papelera <span className="count-pill">{trashCount}</span>
          </button>
        )}
        {canManage && selected && (
          <button className="btn ghost solo-ancho" onClick={() => setShowEditPeriodo(true)} title="Editar las fechas o el nombre">
            {IconEdit} Editar período
          </button>
        )}
        {canManage && selected && (
          <button className="btn btn-del solo-ancho" onClick={() => setShowDelete(true)} title="Borrar período">
            {IconTrash} Borrar
          </button>
        )}
      </div>

      <div className="content">
        {omitidas > 0 && (
          <div className="banner crit hub-banner" role="status">
            <div>
              <b>
                {omitidas === 1
                  ? "1 renglón no volvió al pedido"
                  : `${omitidas} renglones no volvieron al pedido`}
              </b>
              <p>
                Su producto se eliminó del catálogo después de guardada esa versión. El resto se
                recuperó como estaba.
              </p>
            </div>
            <button type="button" className="btn ghost" onClick={() => setOmitidas(0)}>
              Entendido
            </button>
          </div>
        )}
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
            {snapshotError && <MensajeDeError>{snapshotError}</MensajeDeError>}
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
          <div className="hub-cuerpo">
            <div className="tiles">
              <div className="tile">
                <div className="k"><span className="dot" style={{ background: "var(--ink)" }} />Eventos</div>
                <div className="v">{totalEventos}</div>
              </div>
              <div className="tile">
                <div className="k">
                  <span className="dot" style={{ background: "var(--ok)" }} />
                  <span className="solo-ancho">Productos que alcanzan</span>
                  <span className="solo-celular">Alcanzan</span>
                </div>
                <div className="v">{alert.okCount}<small> / {alert.totalReut}</small></div>
              </div>
              <div className="tile">
                <div className="k">
                  <span className="dot" style={{ background: "var(--crit)" }} />
                  <span className="solo-ancho">Sin stock suficiente</span>
                  <span className="solo-celular">Sin stock</span>
                </div>
                <div className="v" style={{ color: alert.overProducts.length ? "var(--crit)" : "var(--ink)" }}>
                  {alert.overProducts.length}
                </div>
              </div>
            </div>

            {alert.overProducts.length > 0 ? (
              <div className="banner crit hub-banner">
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
              <div className="banner ok hub-banner">
                {IconCheck}
                {/* Lo que nunca se contó no entra en la cuenta: decir "todo
                    alcanza" con productos sin contar sería afirmar algo que
                    nadie sabe. */}
                {alert.sinRecuento > 0 ? (
                  <div>
                    <b>Nada de lo contado se pasa del stock</b>
                    <p>
                      {alert.sinRecuento === 1
                        ? "Hay 1 producto sin contar: de ese no se sabe si alcanza."
                        : `Hay ${alert.sinRecuento} productos sin contar: de esos no se sabe si alcanzan.`}
                    </p>
                  </div>
                ) : (
                  <div>
                    <b>Todo alcanza para este período</b>
                    <p>Ningún producto se pasa del stock disponible.</p>
                  </div>
                )}
              </div>
            )}

            <div className="hub-eventos">
              <div className="section-title">
                {/* El título es solo "Por hacer": el contador y el botón van al lado, no adentro. */}
                <h2>Por hacer</h2> <span className="count-pill">{selected.events.length}</span>
                <span className="spacer" style={{ flex: 1 }} />
                {totalEventos > 0 && (
                  <Link className="btn ghost" href={`/periodo/${selected.id}`}>
                    {IconList} Resumen del depósito
                  </Link>
                )}
              </div>

              {totalEventos === 0 ? (
                <div className="empty-card">
                  <p className="empty-title">Este período no tiene eventos todavía</p>
                  {canManage && <button className="btn primary" onClick={() => setShowEvent(true)}>{IconPlus} Agregar evento</button>}
                </div>
              ) : selected.events.length === 0 ? (
                // El período sigue abierto pero ya se hizo todo lo que tenía.
                // Decir "no tiene eventos" sería mentira: están abajo, plegados.
                <div className="empty-card">
                  <p className="empty-title">No queda nada por hacer en este período</p>
                  <p>
                    {selected.pasados.length === 1
                      ? "Su único evento ya se hizo y está acá abajo."
                      : `Sus ${selected.pasados.length} eventos ya se hicieron y están acá abajo.`}
                  </p>
                </div>
              ) : (
                <div className="event-grid">{selected.events.map(tarjetaDeEvento)}</div>
              )}
            </div>

            {selected.pasados.length > 0 && (
              // <details> nativo: se pliega sin estado propio y anda con el teclado.
              <details className="pasados">
                <summary>
                  {IconHistory}
                  <span>Ya pasaron</span>
                  <span className="count-pill">{selected.pasados.length}</span>
                </summary>
                <div className="event-grid">{selected.pasados.map(tarjetaDeEvento)}</div>
              </details>
            )}
          </div>
        )}
      </div>

      {showPeriodo && (
        <NewPeriodModal
          draftKey={periodDraftKey}
          onClose={() => { clearDraft(periodDraftKey); setShowPeriodo(false); }}
          onCreated={(id) => {
            setShowPeriodo(false);
            router.push(`/?w=${id}`);
            router.refresh();
          }}
        />
      )}
      {showEvent && (
        <NewEventModal
          draftKey={eventDraftKey}
          onClose={() => { clearDraft(eventDraftKey); setShowEvent(false); }}
          onCreated={(id) => {
            setShowEvent(false);
            router.push(`/evento/${id}`);
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
          eventCount={totalEventos}
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
          // Borrar y descartar alcanzan al período entero, también a lo ya hecho.
          currentLines={[...selected.events, ...selected.pasados].reduce((n, e) => n + e.lineCount, 0)}
          eventCount={totalEventos}
          onClose={() => setShowDiscard(false)}
          onDiscarded={(n) => {
            setShowDiscard(false);
            setOmitidas(n);
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
          onRestored={(periodId, n = 0) => {
            setShowTrash(false);
            setOmitidas(n);
            if (periodId) router.push(`/?w=${periodId}`);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function TrashModal({
  trash,
  onClose,
  onRestored,
}: {
  trash: HubData["trash"];
  onClose: () => void;
  onRestored: (periodId?: string, omitidas?: number) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function recuperar(kind: "period" | "event" | "version", id: string) {
    setBusy(id);
    setErr(null);
    // Recuperar un período o un evento lleva al período recuperado; restaurar una
    // versión de pedidos deja donde estás, porque el período no se movió.
    if (kind === "version") {
      const res = await intentar(() => restorePeriodVersion(id));
      setBusy(null);
      if (!res.ok) return setErr(res.error ?? "No se pudo restaurar.");
      return onRestored(undefined, res.omitidas ?? 0);
    }
    const res = await intentar(() => (kind === "period" ? restorePeriod(id) : restoreEvent(id)));
    setBusy(null);
    if (!res.ok) return setErr(res.error ?? "No se pudo recuperar.");
    onRestored(res.id);
  }

  return (
    <Dialogo titulo="Papelera" onCerrar={onClose} ocupado={busy !== null} ancho="wide">
      <p className="modal-sub">
        Recuperá lo que necesites y vuelve con sus pedidos como estaban. Esto
        se vacía solo los lunes: lo que tires esta semana se borra para siempre
        el lunes que viene.
      </p>
      {err && <MensajeDeError>{err}</MensajeDeError>}

      <div className="trash-list">
        {trash.periodos.map((w) => (
          <div className="trash-item" key={w.id}>
            <div>
              <b>{w.label}</b>
              <div className="trash-meta">
                Período · {w.rangeLabel} · {w.eventCount} {w.eventCount === 1 ? "evento" : "eventos"} · borrado el {w.deletedLabel}
              </div>
            </div>
            <button type="button" className="btn ghost" onClick={() => recuperar("period", w.id)} disabled={busy !== null}>
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
            <button type="button" className="btn ghost" onClick={() => recuperar("event", e.id)} disabled={busy !== null}>
              {IconUndo} {busy === e.id ? "Recuperando…" : "Recuperar"}
            </button>
          </div>
        ))}
        {trash.versions.map((v) => (
          <div className="trash-item" key={v.id}>
            <div>
              <b>Pedidos de {v.periodLabel}</b>
              <div className="trash-meta">
                {v.kind === "PRE_DESCARTE" ? "Antes de descartar cambios" : v.kind === "PRE_COPIA" ? "Antes de copiar un pedido encima" : "Antes de restaurar otra versión"} ·{" "}
                {v.lineCount} {v.lineCount === 1 ? "producto" : "productos"} · {v.actorName} · {v.atLabel}
              </div>
              {v.preparados > 0 && (
                <div className="trash-meta prep-ojo">
                  {v.preparados} {v.preparados === 1 ? "ítem ya está preparado y va a cambiar" : "ítems ya están preparados y van a cambiar"}
                </div>
              )}
            </div>
            <button type="button" className="btn ghost" onClick={() => recuperar("version", v.id)} disabled={busy !== null}>
              {IconUndo} {busy === v.id ? "Restaurando…" : "Restaurar"}
            </button>
          </div>
        ))}
      </div>

      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose} disabled={busy !== null}>Cerrar</button>
      </div>
    </Dialogo>
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
  onDiscarded: (omitidas: number) => void;
}) {
  const omitidas = useRef(0);
  return (
    <Confirmar
      titulo="¿Descartar cambios?"
      textoConfirmar="Sí, descartar cambios"
      textoEnCurso="Descartando…"
      peligro
      accion={async () => {
        const res = await discardPeriodChanges(id);
        omitidas.current = res.omitidas ?? 0;
        return res;
      }}
      alListo={() => onDiscarded(omitidas.current)}
      onCerrar={onClose}
      pie={
        <div className="banner ok" style={{ marginBottom: "var(--sp-4)" }}>
          <div>
            <b>Se guarda una copia antes de descartar</b>
            <p>Si te arrepentís, la recuperás entera desde la Papelera.</p>
          </div>
        </div>
      }
    >
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
    </Confirmar>
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
  return (
    <Confirmar
      titulo="¿Borrar este período?"
      textoConfirmar="Sí, borrar"
      textoEnCurso="Borrando…"
      peligro
      accion={() => deletePeriod(id)}
      alListo={onDeleted}
      onCerrar={onClose}
    >
      Se va a borrar <b>{label}</b>
      {eventCount > 0
        ? ` junto con sus ${eventCount} evento${eventCount > 1 ? "s" : ""} y todos sus pedidos`
        : ""}
      . Va a la papelera: lo podés recuperar hasta que se vacíe, el lunes.
    </Confirmar>
  );
}

function NewPeriodModal({ draftKey, onClose, onCreated }: { draftKey: string; onClose: () => void; onCreated: (id: string) => void }) {
  const draft = useSessionDraft(draftKey, { label: "", startDay: "", endDay: "", unSoloDia: false as boolean });
  const { label, startDay, endDay, unSoloDia } = draft.value;
  const setLabel = (v: string) => draft.setField("label", v);
  const setStart = (v: string) => draft.setField("startDay", v);
  const setEnd = (v: string) => draft.setField("endDay", v);
  const setUnSoloDia = (v: boolean) => draft.setField("unSoloDia", v);
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState<{ nombre: string } | null>(null);

  const hasta = unSoloDia ? startDay : endDay;
  const sePuedeCrear = Boolean(startDay) && Boolean(hasta);
  // Cerrar tira el borrador (lo borra quien abrió la ventana): por el fondo o
  // con Escape, primero se pregunta.
  const ventana = { onCerrar: onClose, ocupado: saving, cambiado: Boolean(label || startDay || endDay), sinDeslizar: true } as const;

  async function save(permitirDuplicado = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await createPeriod({ label, startDay, endDay: hasta, permitirDuplicado });
      if (res.duplicado) return setDuplicado({ nombre: res.duplicado.nombre });
      if (res.ok && res.id) { draft.clear(); onCreated(res.id); }
      else setError(res.error ?? "No se pudo crear.");
    } catch (e) {
      setError(mensajeDeFallo(e));
      avisarDeFalloAlGuardar(e);
    } finally { inFlight.current = false; setSaving(false); }
  }

  if (duplicado) {
    return (
      <Dialogo titulo="Ya existe uno igual" {...ventana}>
        {error && <MensajeDeError>{error}</MensajeDeError>}
        <div className="msub">
          <b>{duplicado.nombre}</b> ya cubre exactamente esas fechas. Podés usar ese, o crear otro igual si de
          verdad son dos grupos distintos de vajilla.
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>Usar el que existe</button>
          <button type="button" className="btn primary" onClick={() => save(true)} disabled={saving}>
            {saving ? "Creando…" : "Crear otro igual"}
          </button>
        </div>
      </Dialogo>
    );
  }

  return (
    <Dialogo
      titulo="Nuevo período operativo"
      {...ventana}
      alEnviar={() => {
        if (sePuedeCrear) void save();
      }}
    >
      <div className="msub">
        Los eventos de un período comparten la misma vajilla. Puede ser una sola jornada o los días que hagan
        falta, cualquier día de la semana.
      </div>
      <Campo label="Nombre (opcional)">
        <input
          disabled={saving} type="text"
          placeholder="Si lo dejás vacío, se muestran las fechas"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </Campo>
      <div style={{ display: "flex", gap: 12 }}>
        <Campo label="Desde" style={{ flex: 1 }}>
          <input disabled={saving} type="date" value={startDay} onChange={(e) => setStart(e.target.value)} autoFocus />
        </Campo>
        {!unSoloDia && (
          <Campo label="Hasta" style={{ flex: 1 }}>
            <input disabled={saving} type="date" value={endDay} onChange={(e) => setEnd(e.target.value)} />
          </Campo>
        )}
      </div>
      <label className="check-line">
        <input disabled={saving} type="checkbox" checked={unSoloDia} onChange={(e) => setUnSoloDia(e.target.checked)} />
        Es un solo día
      </label>
      {error && <MensajeDeError>{error}</MensajeDeError>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" className="btn primary" disabled={saving || !sePuedeCrear}>
          {saving ? "Creando…" : "Crear"}
        </button>
      </div>
    </Dialogo>
  );
}

function NewEventModal({ draftKey, onClose, onCreated }: { draftKey: string; onClose: () => void; onCreated: (id: string) => void }) {
  const draft = useSessionDraft(draftKey, { lugar: "", date: "", guests: "", responsable: "" });
  const { lugar, date, guests, responsable } = draft.value;
  const setLugar = (v: string) => draft.setField("lugar", v);
  const setDate = (v: string) => draft.setField("date", v);
  const setGuests = (v: string) => draft.setField("guests", v);
  const setResponsable = (v: string) => draft.setField("responsable", v);
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El período no se pide: sale de la fecha, que es el dato que la persona
  // tiene. Solo se pregunta cuando hay más de uno que la cubre, o ninguno.
  const [elegir, setElegir] = useState<{ id: string; nombre: string; rango: string }[] | null>(null);
  const [falta, setFalta] = useState<{ label: string } | null>(null);

  const sePuedeCrear = Boolean(lugar.trim()) && Boolean(date);
  // Como en "Nuevo período": cerrar tira el borrador, así que antes se pregunta.
  const ventana = { onCerrar: onClose, ocupado: saving, cambiado: Boolean(lugar || date || guests || responsable), sinDeslizar: true } as const;

  async function save(opciones: { periodoElegidoId?: string; crearPeriodo?: boolean } = {}) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await createEvent({ lugar, date, guests: guests.trim() === "" ? 0 : Number(guests), responsable, ...opciones });
      if (res.elegirPeriodo) { setFalta(null); return setElegir(res.elegirPeriodo); }
      if (res.faltaPeriodo) { setElegir(null); return setFalta({ label: res.faltaPeriodo.label }); }
      if (res.ok && res.id) { draft.clear(); onCreated(res.id); }
      else setError(res.error ?? "No se pudo crear.");
    } catch (e) {
      setError(mensajeDeFallo(e));
      avisarDeFalloAlGuardar(e);
    } finally { inFlight.current = false; setSaving(false); }
  }

  if (elegir) {
    return (
      <Dialogo titulo="¿A qué período va?" {...ventana}>
        {error && <MensajeDeError>{error}</MensajeDeError>}
        <div className="msub">
          Hay más de un período que incluye esa fecha. Elegí cuál corresponde: de eso depende contra qué stock
          se cuenta el pedido.
        </div>
        <div className="sug-list">
          {elegir.map((p) => (
            <button key={p.id} type="button" className="sug-row" onClick={() => save({ periodoElegidoId: p.id })} disabled={saving}>
              <span className="sug-row-title">{p.nombre}</span>
              <span className="sug-row-meta">{p.rango}</span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={() => setElegir(null)} disabled={saving}>Volver</button>
        </div>
      </Dialogo>
    );
  }

  if (falta) {
    return (
      <Dialogo titulo="Falta el período de esa fecha" {...ventana} alEnviar={() => void save({ crearPeriodo: true })}>
        {error && <MensajeDeError>{error}</MensajeDeError>}
        <div className="msub">
          Ningún período incluye ese día. Se puede crear <b>{falta.label}</b> y poner el evento ahí; después
          podés estirarlo si el trabajo abarca más días.
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={() => setFalta(null)} disabled={saving}>Volver</button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Creando…" : "Crear y agregar"}
          </button>
        </div>
      </Dialogo>
    );
  }

  return (
    <Dialogo
      titulo="Nuevo evento"
      {...ventana}
      alEnviar={() => {
        if (sePuedeCrear) void save();
      }}
    >
      <div className="msub">Cargá los datos del evento. El período sale de la fecha.</div>
      <Campo label="Lugar">
        <input disabled={saving} type="text" placeholder="Ej: Puerto, Salón Roble…" value={lugar} onChange={(e) => setLugar(e.target.value)} autoFocus />
      </Campo>
      <Campo label="Fecha y hora">
        <input disabled={saving} type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
      </Campo>
      <div style={{ display: "flex", gap: 12 }}>
        <Campo label="Invitados" style={{ flex: 1 }}>
          <input disabled={saving} type="number" onWheel={sinRueda} inputMode="numeric" min={0} placeholder="0" value={guests} onChange={(e) => setGuests(e.target.value)} />
        </Campo>
        <Campo label="Responsable" style={{ flex: 1.4 }}>
          <input disabled={saving} type="text" placeholder="Nombre" value={responsable} onChange={(e) => setResponsable(e.target.value)} />
        </Campo>
      </div>
      {error && <MensajeDeError>{error}</MensajeDeError>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" className="btn primary" disabled={saving || !sePuedeCrear}>
          {saving ? "Creando…" : "Crear evento"}
        </button>
      </div>
    </Dialogo>
  );
}
