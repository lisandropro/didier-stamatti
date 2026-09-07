"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AutosaveQueue } from "@/lib/autosave";
import { avisarDeFalloAlGuardar, mensajeDeFallo } from "@/lib/actualizacion";
import { validQuantity, MAX_QUANTITY } from "@/lib/quantity";
import { setLine, addCustomLine, setCustomQty, deleteLine, copyOrderFromEvent } from "@/app/actions/order";
import { marcarGuardado, marcarPendiente } from "@/lib/trabajo-pendiente";
import { computeShortage } from "@/lib/shortage-rule";
import { ShortagesModal } from "@/components/ShortagesModal";
import { EditEventModal } from "@/components/EditEventModal";
import { ResponsableEditor } from "@/components/ResponsableEditor";
import { setEventStatus } from "@/app/actions/period";
import { OPCIONES_CATEGORIA as CATS } from "@/lib/categories";

type ProductRow = {
  id: string;
  name: string;
  category: string;
  rubro: string | null;
  type: string;
  unit: string;
  /** null = nunca se contó: no se puede saber si alcanza. */
  stock: number | null;
  reserved: number; // pedido por los OTROS eventos del finde
  qty: number;
  note: string;
  /** Dado de baja del catálogo. Solo llega si este pedido ya lo tiene cargado. */
  deBaja?: boolean;
};
type OrderSave = { kind: "product"; row: ProductRow } | { kind: "custom"; id: string; qty: number };

type CustomLine = { id: string; name: string; unit: string | null; qty: number; note: string | null; category: string };
type SourceEvent = { id: string; lugar: string; dateLabel: string; periodLabel: string; lineCount: number };
type Data = {
  event: {
    id: string;
    lugar: string;
    subLabel: string;
    status: string;
    responsable: string | null;
    dateLocal: string;
    guests: number;
    periodoLabel: string;
  };
  products: ProductRow[];
  customLines: CustomLine[];
  sourceEvents: SourceEvent[];
};


const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const IconWarn = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
);
const IconTrash = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 13h9l1-13" /></svg>
);
const IconEdit = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const IconCopy = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>
);

export function OrderBuilder({ data }: { data: Data }) {
  const router = useRouter();
  const [items, setItems] = useState<ProductRow[]>(data.products);
  const [customs, setCustoms] = useState<CustomLine[]>(data.customLines);
  const [tab, setTab] = useState<string>("ENSERES");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(data.event.status);
  const [statusSaving, setStatusSaving] = useState(false);
  const [queue] = useState(() => new AutosaveQueue<OrderSave>((value) => value.kind === "product"
    ? setLine({ eventId: data.event.id, productId: value.row.id, qty: value.row.qty, note: value.row.note })
    : setCustomQty(value.id, value.qty), 700, marcarPendiente, marcarGuardado));
  const saveStatus = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const pending = saveStatus.pending;
  const savedOnce = saveStatus.saved;
  const currentItems = useRef(items);
  const [error, setError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  const [showCopy, setShowCopy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showShortages, setShowShortages] = useState(false);
  useEffect(() => {
    function leaving(event: BeforeUnloadEvent) {
      if (queue.getSnapshot().pending) { event.preventDefault(); event.returnValue = ""; }
    }
    async function navigate(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !queue.getSnapshot().pending) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute("download")) return;
      const url = new URL(link.href);
      if (url.origin !== location.origin) return;
      event.preventDefault();
      event.stopPropagation();
      if (await queue.flush()) router.push(url.pathname + url.search + url.hash);
    }
    window.addEventListener("beforeunload", leaving);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", leaving);
      document.removeEventListener("click", navigate, true);
      void queue.close();
    };
  }, [queue, router]);

  function updateItem(id: string, patch: Partial<ProductRow>) {
    const previous = currentItems.current.find((p) => p.id === id);
    if (!previous) return;
    const next = { ...previous, ...patch };
    if (!validQuantity(next.qty)) return;
    currentItems.current = currentItems.current.map((p) => p.id === id ? next : p);
    setItems(currentItems.current);
    queue.schedule(id, { kind: "product", row: next });
  }

  function stepQty(id: string, delta: number) {
    const previous = currentItems.current.find((p) => p.id === id);
    if (previous) updateItem(id, { qty: Math.max(0, Math.min(MAX_QUANTITY, previous.qty + delta)) });
  }

  // ---- aviso del finde en vivo (este evento + lo reservado por los otros) ----
  // Usa la MISMA función que el panel "Ver faltantes" de la vista general, para
  // que los dos no puedan decir cosas distintas del mismo pedido.
  const over = useMemo(
    () =>
      items.filter((p) =>
        computeShortage({
          productId: p.id,
          name: p.name,
          unit: p.unit,
          rubro: p.rubro,
          type: p.type,
          stock: p.stock,
          requested: p.qty,
          otherRequested: p.reserved,
        })
      ),
    [items]
  );

  const q = norm(query.trim());
  const searching = q.length > 0;
  const visible = items.filter((p) => {
    // Un producto dado de baja se muestra solo si este pedido ya lo tiene: hay
    // que poder sacarlo, pero no ofrecerlo para agregar a un pedido nuevo.
    if (p.deBaja && p.qty === 0) return false;
    if (searching) return norm(`${p.name} ${p.rubro ?? ""}`).includes(q);
    return p.category === tab;
  });

  const inOrderCount = items.filter((p) => p.qty > 0).length + customs.length;

  async function toggleStatus() {
    if (statusSaving || !(await queue.flush())) return;
    const next = status === "LISTO" ? "NO_LISTO" : "LISTO";
    setStatusSaving(true);
    setError(null);
    try {
      const result = await setEventStatus(data.event.id, next);
      if (result.ok) setStatus(next);
      else setError(result.error ?? "No se pudo cambiar el estado.");
    } catch { setError("No se pudo cambiar el estado. Revisá la conexión."); }
    finally { setStatusSaving(false); }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{data.event.lugar}</h1>
          <div className="sub">
            {data.event.subLabel} · {inOrderCount} producto{inOrderCount === 1 ? "" : "s"} en el pedido
            <span className="save-ind">
              {saveStatus.error ? " · Sin guardar" : pending > 0 ? " · Guardando…" : savedOnce ? " · Guardado ✓" : " · Se guarda solo mientras cargás"}
            </span>
          </div>
        </div>
        <div className="spacer" />
        <Link className="btn ghost" href="/">Volver</Link>
        {/* Único lugar donde se informan los faltantes: no hay banner aparte. */}
        {over.length > 0 && (
          <button className="btn btn-falta btn-falta-top" onClick={() => setShowShortages(true)}>
            {IconWarn} Ver faltantes <span className="count-pill">{over.length}</span>
          </button>
        )}
        <button className="btn ghost" onClick={() => setShowEdit(true)}>{IconEdit} Editar evento</button>
        <button className="btn ghost" disabled={pending > 0} onClick={() => setShowCopy(true)}>{IconCopy} Repetir pedido</button>
        <Link className="btn ghost" href={`/evento/${data.event.id}/pdf`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M7 8V3.5h10V8M7 17h10v3.5H7z" /><path d="M4.5 8h15a1.5 1.5 0 0 1 1.5 1.5V16h-4M3 16h4M3 9.5A1.5 1.5 0 0 1 4.5 8" />
          </svg>
          PDF del pedido
        </Link>
        <button className={`btn${status === "LISTO" ? "" : " primary"}`} disabled={pending > 0 || statusSaving} onClick={toggleStatus}>
          {status === "LISTO" ? "✓ Listo — volver a borrador" : "Marcar como listo"}
        </button>
      </div>

      <div className="content">
        {(error || saveStatus.error) && (
          <div role="alert" className="banner crit">{IconWarn}<div><b>{error || saveStatus.error}</b>
            {saveStatus.error && <button className="btn ghost" onClick={() => { void queue.flush(); }}>Reintentar guardado</button>}
          </div></div>
        )}

        <div className="ro-resp">
          <span className="ro-resp-label">Responsable de la fiesta</span>
          <ResponsableEditor eventId={data.event.id} responsable={data.event.responsable} canEdit />
        </div>


        <div className="searchbar">
          <label className="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
            <input
              placeholder="Buscar en todo el catálogo…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {!searching &&
            CATS.map((c) => (
              <button key={c.v} className={`tab${tab === c.v ? " active" : ""}`} onClick={() => setTab(c.v)}>
                {c.l}
              </button>
            ))}
          {!searching && (
            <button className={`tab${tab === "EXTRAS" ? " active" : ""}`} onClick={() => setTab("EXTRAS")}>
              Extras{customs.length > 0 ? ` (${customs.length})` : ""}
            </button>
          )}
        </div>

        {tab === "EXTRAS" && !searching ? (
          <ExtrasPanel
            eventId={data.event.id}
            customs={customs}
            setCustoms={setCustoms}
            onRefresh={() => router.refresh()}
            queue={queue}
            onError={setError}
          />
        ) : (
          <div className="olist">
            {visible.length === 0 && (
              <div className="emptyrow">No hay productos que coincidan con la búsqueda.</div>
            )}
            {visible.map((p) => {
              const reutil = p.type === "REUTILIZABLE";
              const total = p.qty + p.reserved;
              // Sin recuento no se puede decir si alcanza: no se sabe cuánto hay.
              // Se avisa que falta contarlo, que es lo único cierto.
              const contado = reutil && p.stock !== null;
              const hay = p.stock ?? 0;
              const pct = contado && hay > 0 ? Math.min(100, Math.round((total / hay) * 100)) : total > 0 ? 100 : 0;
              const st =
                !reutil
                  ? null
                  : !contado
                    ? { cls: "neutral", txt: "Sin contar", fill: "var(--muted)" }
                  : total > hay
                    ? { cls: "crit", txt: `Faltan ${total - hay}`, fill: "var(--crit)" }
                    : total === hay && total > 0
                      ? { cls: "warn", txt: "Al límite", fill: "var(--warn)" }
                      : p.qty > 0
                        ? { cls: "ok", txt: "Alcanza", fill: "var(--ok)" }
                        : null;
              return (
                <div key={p.id} className={`orow${p.qty > 0 ? " has-qty" : ""}`}>
                  <div className="ocol-name">
                    <div className="pname">
                      {p.name}
                      {p.deBaja && <span className="chip crit chip-baja">Dado de baja</span>}
                    </div>
                    <div className="rubro">
                      {searching ? `${CATS.find((c) => c.v === p.category)?.l ?? p.category} · ` : ""}
                      {p.rubro}
                      {p.unit !== "Unidad" ? ` · por ${p.unit.toLowerCase()}` : ""}
                      {p.deBaja ? " · ya no está en el catálogo, poné 0 para sacarlo" : ""}
                    </div>
                    <button
                      className={`note-toggle${p.note ? " has-note" : ""}`}
                      onClick={() => setNoteOpen((s) => ({ ...s, [p.id]: !s[p.id] }))}
                    >
                      {p.note ? `✎ ${p.note}` : "+ nota"}
                    </button>
                    {noteOpen[p.id] && (
                      <input
                        className="note-input"
                        type="text"
                        placeholder="Aclaración… (ej: doradas, para postre)"
                        value={p.note}
                        autoFocus
                        onChange={(e) => updateItem(p.id, { note: e.target.value })}
                        onBlur={() => setNoteOpen((s) => ({ ...s, [p.id]: false }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setNoteOpen((s) => ({ ...s, [p.id]: false }));
                        }}
                      />
                    )}
                  </div>

                  <div className="ocol-stock">
                    {reutil ? (
                      <>
                        <div className="bar"><div className="fill" style={{ width: `${pct}%`, background: st?.fill ?? "var(--muted)" }} /></div>
                        <div className="line">
                          Depósito: <b>{p.stock ?? "sin contar"}</b> · Otros eventos: <b>{p.reserved}</b>
                          {st && <span className={`chip ${st.cls}`}>{st.txt}</span>}
                        </div>
                      </>
                    ) : (
                      <span className="chip neutral">Se compra por evento</span>
                    )}
                  </div>

                  <div className="ocol-qty">
                    <button className="qbtn wide" onClick={() => stepQty(p.id, -10)} aria-label="Restar diez">−10</button>
                    <button className="qbtn" onClick={() => stepQty(p.id, -1)} aria-label="Restar uno">−</button>
                    <input
                      className="qinput"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={p.qty === 0 ? "" : p.qty}
                      placeholder="0"
                      onChange={(e) => {
                        const n = e.target.value.trim() === "" ? 0 : Math.max(0, Math.round(Number(e.target.value)));
                        updateItem(p.id, { qty: Number.isFinite(n) ? n : 0 });
                      }}
                      aria-label={`Cantidad de ${p.name}`}
                    />
                    <button className="qbtn" onClick={() => stepQty(p.id, 1)} aria-label="Sumar uno">+</button>
                    <button className="qbtn wide" onClick={() => stepQty(p.id, 10)} aria-label="Sumar diez">+10</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="hint">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>
          Lo vacío no va en el pedido. “Otros eventos” es lo que ya pidieron los demás eventos de este período del mismo depósito.
        </div>
      </div>

      {showShortages && (
        <ShortagesModal
          eventId={data.event.id}
          lugar={data.event.lugar}
          onClose={() => setShowShortages(false)}
        />
      )}
      {showCopy && (
        <CopyOrderModal
          targetEventId={data.event.id}
          hasLines={inOrderCount > 0}
          sourceEvents={data.sourceEvents}
          onClose={() => setShowCopy(false)}
        />
      )}
      {showEdit && (
        <EditEventModal
          evento={{
            id: data.event.id,
            lugar: data.event.lugar,
            dateLocal: data.event.dateLocal,
            guests: data.event.guests,
            periodoLabel: data.event.periodoLabel,
          }}
          onClose={() => setShowEdit(false)}
          onSaved={() => setShowEdit(false)}
        />
      )}
    </>
  );
}

function CopyOrderModal({
  targetEventId,
  hasLines,
  sourceEvents,
  onClose,
}: {
  targetEventId: string;
  hasLines: boolean;
  sourceEvents: SourceEvent[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<SourceEvent | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
    const res = await copyOrderFromEvent(targetEventId, selected.id);
    if (res.ok) {
      // Recarga completa: el armador siembra su estado desde el servidor al montar,
      // así el pedido copiado se ve reflejado de forma confiable.
      window.location.reload();
    } else {
      setSaving(false);
      setError(res.error ?? "No se pudo copiar.");
    }
    } catch (error) { setError(mensajeDeFallo(error)); avisarDeFalloAlGuardar(error); }
    finally { setSaving(false); }
  }

  const q = norm(query.trim());
  const list = q
    ? sourceEvents.filter((e) => norm(`${e.lugar} ${e.periodLabel}`).includes(q))
    : sourceEvents;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {selected ? (
          <>
            <h2>¿Copiar este pedido?</h2>
            <div className="msub">
              Vas a traer el pedido de <b>{selected.lugar}</b> ({selected.dateLabel}, {selected.lineCount} producto
              {selected.lineCount === 1 ? "" : "s"}) a este evento.
              {hasLines && <> <b>Reemplaza</b> lo que ya cargaste en este evento.</>}
            </div>
            {error && <div className="login-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setSelected(null)} disabled={saving}>Volver</button>
              <button className="btn primary" onClick={confirm} disabled={saving}>
                {saving ? "Copiando…" : "Copiar pedido"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Repetir pedido</h2>
            <div className="msub">Elegí un evento anterior y traé su pedido a este, para no cargarlo de cero.</div>
            {sourceEvents.length === 0 ? (
              <div className="emptyrow">Todavía no hay otros eventos con pedido para copiar.</div>
            ) : (
              <>
                <label className="search" style={{ marginBottom: "var(--sp-3)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
                  <input placeholder="Buscar por lugar o período…" value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <div className="copy-list">
                  {list.map((e) => (
                    <button key={e.id} className="copy-row" onClick={() => setSelected(e)}>
                      <div>
                        <div className="copy-lugar">{e.lugar}</div>
                        <div className="copy-meta">{e.periodLabel} · {e.dateLabel}</div>
                      </div>
                      <span className="chip neutral">{e.lineCount} prod.</span>
                    </button>
                  ))}
                  {list.length === 0 && <div className="emptyrow">No hay eventos que coincidan.</div>}
                </div>
              </>
            )}
            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose}>Cerrar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ExtrasPanel({
  eventId,
  customs,
  setCustoms,
  onRefresh,
  queue,
  onError,
}: {
  eventId: string;
  customs: CustomLine[];
  setCustoms: React.Dispatch<React.SetStateAction<CustomLine[]>>;
  onRefresh: () => void;
  queue: AutosaveQueue<OrderSave>;
  onError: (error: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [qty, setQty] = useState("1");
  const [saving, setSaving] = useState(false);


  async function add() {
    if (!name.trim() || !category || saving) return;
    if (!validQuantity(Number(qty), 1)) { onError("Ingresá una cantidad entera mayor que cero."); return; }
    setSaving(true);
    onError(null);
    marcarPendiente();
    try {
    const res = await addCustomLine({ eventId, name, category, unit, qty: Number(qty) || 1 });
    if (res.ok && res.lineId) {
      setCustoms((prev) => [
        ...prev,
        {
          id: res.lineId as string,
          name: name.trim(),
          category,
          unit: unit.trim() || null,
          qty: Math.max(1, Math.round(Number(qty) || 1)),
          note: null,
        },
      ]);
      setName("");
      setCategory("");
      setUnit("");
      setQty("1");
      onRefresh();
    } else { onError(res.error ?? "No se pudo agregar el ítem."); }
    } catch (error) { onError(mensajeDeFallo(error)); avisarDeFalloAlGuardar(error); }
    finally { setSaving(false); marcarGuardado(); }
  }

  function changeQty(id: string, next: number) {
    const q = Math.max(1, next);
    if (saving || !validQuantity(q, 1)) return;
    setCustoms((prev) => prev.map((c) => (c.id === id ? { ...c, qty: q } : c)));
    if (validQuantity(q, 1)) queue.schedule("custom:" + id, { kind: "custom", id, qty: q });
  }

  async function remove(id: string) {
    if (saving) return;
    setSaving(true);
    onError(null);
    marcarPendiente();
    try {
      await queue.cancel("custom:" + id);
      const result = await deleteLine(id);
      if (!result.ok) { onError(result.error ?? "No se pudo quitar el ítem."); return; }
      setCustoms((prev) => prev.filter((c) => c.id !== id));
      onRefresh();
    } catch (error) { onError(mensajeDeFallo(error)); avisarDeFalloAlGuardar(error); }
    finally { setSaving(false); marcarGuardado(); }
  }

  return (
    <>
      <div className="extras-form">
        <div className="field" style={{ flex: 2, marginBottom: 0 }}>
          <label>Ítem fuera de catálogo</label>
          <input type="text" placeholder="Ej: Vajilla alquilada, hielo seco…" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1.1, marginBottom: 0 }}>
          <label>Sector</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="" disabled>Elegir…</option>
            {CATS.map((c) => (
              <option key={c.v} value={c.v}>{c.l}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <label>Unidad (opcional)</label>
          <input type="text" placeholder="Cajas, bolsas…" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </div>
        <div className="field" style={{ width: 90, marginBottom: 0 }}>
          <label>Cantidad</label>
          <input type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <button className="btn primary" onClick={add} disabled={saving || !name.trim() || !category}>
          {saving ? "Agregando…" : "Agregar"}
        </button>
      </div>

      <div className="olist" style={{ marginTop: 16 }}>
        {customs.length === 0 && (
          <div className="emptyrow">
            Sin ítems extra. Estos ítems no llevan control de stock y salen en el pedido del evento.
          </div>
        )}
        {customs.map((c) => (
          <div key={c.id} className="orow has-qty">
            <div className="ocol-name">
              <div className="pname">{c.name}</div>
              <div className="rubro">
                {CATS.find((cat) => cat.v === c.category)?.l ?? c.category} · Fuera de catálogo
                {c.unit ? ` · por ${c.unit.toLowerCase()}` : ""}
              </div>
            </div>
            <div className="ocol-stock">
              <span className="chip neutral">Sin control de stock</span>
            </div>
            <div className="ocol-qty">
              <button className="qbtn" onClick={() => changeQty(c.id, c.qty - 1)} aria-label="Restar uno">−</button>
              <input
                className="qinput"
                type="number"
                inputMode="numeric"
                min={1}
                value={c.qty}
                onChange={(e) => changeQty(c.id, Math.round(Number(e.target.value)) || 1)}
                aria-label={`Cantidad de ${c.name}`}
              />
              <button className="qbtn" onClick={() => changeQty(c.id, c.qty + 1)} aria-label="Sumar uno">+</button>
              <button className="qbtn danger" onClick={() => remove(c.id)} aria-label={`Borrar ${c.name}`}>{IconTrash}</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
