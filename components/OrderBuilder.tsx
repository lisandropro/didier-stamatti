"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { setLine, addCustomLine, setCustomQty, deleteLine } from "@/app/actions/order";
import { setEventStatus } from "@/app/actions/weekend";

type ProductRow = {
  id: string;
  name: string;
  category: string;
  rubro: string | null;
  type: string;
  unit: string;
  stock: number;
  reserved: number; // pedido por los OTROS eventos del finde
  qty: number;
  note: string;
};
type CustomLine = { id: string; name: string; unit: string | null; qty: number; note: string | null; category: string };
type Data = {
  event: { id: string; lugar: string; subLabel: string; status: string };
  products: ProductRow[];
  customLines: CustomLine[];
};

const CATS = [
  { v: "ENSERES", l: "Enseres" },
  { v: "MOBILIARIO", l: "Mobiliario" },
  { v: "BEBIDA", l: "Bebida" },
];

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const IconCheck = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 6 9 17l-5-5" /></svg>
);
const IconWarn = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
);
const IconTrash = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 13h9l1-13" /></svg>
);

export function OrderBuilder({ data }: { data: Data }) {
  const router = useRouter();
  const [items, setItems] = useState<ProductRow[]>(data.products);
  const [customs, setCustoms] = useState<CustomLine[]>(data.customLines);
  const [tab, setTab] = useState<string>("ENSERES");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(data.event.status);
  const [pending, setPending] = useState(0);
  const [savedOnce, setSavedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ---- autosave con debounce por producto ----
  function scheduleSave(p: ProductRow) {
    const t = timers.current.get(p.id);
    if (t) clearTimeout(t);
    timers.current.set(
      p.id,
      setTimeout(async () => {
        timers.current.delete(p.id);
        setPending((n) => n + 1);
        const res = await setLine({ eventId: data.event.id, productId: p.id, qty: p.qty, note: p.note });
        setPending((n) => n - 1);
        setSavedOnce(true);
        if (!res.ok) setError(res.error ?? "No se pudo guardar. Revisá la conexión.");
        else setError(null);
      }, 700)
    );
  }

  function updateItem(id: string, patch: Partial<ProductRow>) {
    setItems((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...patch };
        scheduleSave(next);
        return next;
      })
    );
  }

  function stepQty(id: string, d: number) {
    setItems((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, qty: Math.max(0, p.qty + d) };
        scheduleSave(next);
        return next;
      })
    );
  }

  // ---- aviso del finde en vivo (este evento + lo reservado por los otros) ----
  const over = useMemo(
    () =>
      items.filter((p) => p.type === "REUTILIZABLE" && p.qty + p.reserved > p.stock),
    [items]
  );

  const q = norm(query.trim());
  const searching = q.length > 0;
  const visible = items.filter((p) => {
    if (searching) return norm(`${p.name} ${p.rubro ?? ""}`).includes(q);
    return p.category === tab;
  });

  const inOrderCount = items.filter((p) => p.qty > 0).length + customs.length;

  async function toggleStatus() {
    const next = status === "LISTO" ? "NO_LISTO" : "LISTO";
    setStatus(next);
    const res = await setEventStatus(data.event.id, next as "LISTO" | "NO_LISTO");
    if (!res.ok) setStatus(status);
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{data.event.lugar}</h1>
          <div className="sub">
            {data.event.subLabel} · {inOrderCount} producto{inOrderCount === 1 ? "" : "s"} en el pedido
            <span className="save-ind">
              {pending > 0 ? " · Guardando…" : savedOnce ? " · Guardado ✓" : " · Se guarda solo mientras cargás"}
            </span>
          </div>
        </div>
        <div className="spacer" />
        <Link className="btn ghost" href="/">Volver</Link>
        <Link className="btn ghost" href={`/evento/${data.event.id}/pdf`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M7 8V3.5h10V8M7 17h10v3.5H7z" /><path d="M4.5 8h15a1.5 1.5 0 0 1 1.5 1.5V16h-4M3 16h4M3 9.5A1.5 1.5 0 0 1 4.5 8" />
          </svg>
          PDF del pedido
        </Link>
        <button className={`btn${status === "LISTO" ? "" : " primary"}`} onClick={toggleStatus}>
          {status === "LISTO" ? "✓ Listo — volver a borrador" : "Marcar como listo"}
        </button>
      </div>

      <div className="content">
        {error && (
          <div className="banner crit">{IconWarn}<div><b>{error}</b></div></div>
        )}

        {over.length > 0 ? (
          <div className="banner crit">
            {IconWarn}
            <div>
              <b>
                Sumando todos los eventos del finde, {over.length} producto{over.length > 1 ? "s se pasan" : " se pasa"} del stock
              </b>
              <p>
                {over.slice(0, 3).map((p) => `${p.name} (faltan ${p.qty + p.reserved - p.stock})`).join(" · ")}
                {over.length > 3 ? ` y ${over.length - 3} más` : ""}. Podés seguir igual — es solo un aviso.
              </p>
            </div>
          </div>
        ) : (
          <p className="status-ok">
            {IconCheck}
            Todo alcanza — ningún producto se pasa del stock del fin de semana.
          </p>
        )}

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
          />
        ) : (
          <div className="olist">
            {visible.length === 0 && (
              <div className="emptyrow">No hay productos que coincidan con la búsqueda.</div>
            )}
            {visible.map((p) => {
              const reutil = p.type === "REUTILIZABLE";
              const total = p.qty + p.reserved;
              const pct = reutil && p.stock > 0 ? Math.min(100, Math.round((total / p.stock) * 100)) : total > 0 ? 100 : 0;
              const st =
                !reutil
                  ? null
                  : total > p.stock
                    ? { cls: "crit", txt: `Faltan ${total - p.stock}`, fill: "var(--crit)" }
                    : total === p.stock && total > 0
                      ? { cls: "warn", txt: "Al límite", fill: "var(--warn)" }
                      : p.qty > 0
                        ? { cls: "ok", txt: "Alcanza", fill: "var(--ok)" }
                        : null;
              return (
                <div key={p.id} className={`orow${p.qty > 0 ? " has-qty" : ""}`}>
                  <div className="ocol-name">
                    <div className="pname">{p.name}</div>
                    <div className="rubro">
                      {searching ? `${CATS.find((c) => c.v === p.category)?.l ?? p.category} · ` : ""}
                      {p.rubro}
                      {p.unit !== "Unidad" ? ` · por ${p.unit.toLowerCase()}` : ""}
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
                          Depósito: <b>{p.stock}</b> · Otros eventos: <b>{p.reserved}</b>
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
          Lo vacío no va en el pedido. “Otros eventos” es lo que ya pidieron los demás eventos de este fin de semana del mismo depósito.
        </div>
      </div>
    </>
  );
}

function ExtrasPanel({
  eventId,
  customs,
  setCustoms,
  onRefresh,
}: {
  eventId: string;
  customs: CustomLine[];
  setCustoms: React.Dispatch<React.SetStateAction<CustomLine[]>>;
  onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [qty, setQty] = useState("1");
  const [saving, setSaving] = useState(false);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  async function add() {
    if (!name.trim() || !category) return;
    setSaving(true);
    const res = await addCustomLine({ eventId, name, category, unit, qty: Number(qty) || 1 });
    setSaving(false);
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
    }
  }

  function changeQty(id: string, next: number) {
    const q = Math.max(1, next);
    setCustoms((prev) => prev.map((c) => (c.id === id ? { ...c, qty: q } : c)));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        void setCustomQty(id, q);
      }, 600)
    );
  }

  async function remove(id: string) {
    setCustoms((prev) => prev.filter((c) => c.id !== id));
    await deleteLine(id);
    onRefresh();
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
