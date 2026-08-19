"use client";

import { useEffect, useMemo, useState } from "react";
import { updateStock } from "@/app/actions/stock";
import { NewProductModal } from "@/components/NewProductModal";
import { ProductAdminModal } from "@/components/ProductAdminModal";
import { RowMenu } from "@/components/RowMenu";
import { OPCIONES_CATEGORIA, nombreDeCategoria } from "@/lib/categories";
import { useRouter } from "next/navigation";

type Product = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  rubro: string | null;
  type: string;
  unit: string;
  /** null = nunca se contó. No es lo mismo que cero. */
  stock: number | null;
  active: boolean;
};

// "Todos" no es una categoría: es el filtro apagado, y por eso no vive en
// lib/categories junto a los sectores del depósito.
const CATS = [{ v: "TODOS", l: "Todos" }, ...OPCIONES_CATEGORIA];

const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const IconCheck = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M20 6 9 17l-5-5" /></svg>
);
const IconPlus = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
);
const IconWarn = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 8v5M12 16h.01" /><circle cx="12" cy="12" r="9" /></svg>
);

export function InventoryTable({ products, canEdit }: { products: Product[]; canEdit: boolean }) {
  const [items, setItems] = useState<Product[]>(products);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("TODOS");
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [admin, setAdmin] = useState<Product | null>(null);
  const router = useRouter();

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return items.filter((p) => {
      if (cat !== "TODOS" && p.category !== cat) return false;
      if (!q) return true;
      return norm(`${p.name} ${p.rubro ?? ""}`).includes(q);
    });
  }, [items, query, cat]);

  function handleSaved(id: string, newStock: number) {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, stock: newStock } : p)));
    setEditing(null);
  }

  return (
    <>
      <div className="searchbar">
        <label className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
          <input
            placeholder="Buscar producto… (ej. copa, silla, plato)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {CATS.map((c) => (
          <button
            key={c.v}
            className={`tab${cat === c.v ? " active" : ""}`}
            onClick={() => setCat(c.v)}
          >
            {c.l}
          </button>
        ))}
        {canEdit && (
          <button className="btn primary newprod-btn" onClick={() => setCreating(true)}>
            {IconPlus} Nuevo producto
          </button>
        )}
      </div>

      <div className="countnote">
        Mostrando {filtered.length} de {items.length} productos
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Tipo</th>
              <th>Unidad</th>
              <th>Stock</th>
              <th>Estado</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td className="emptyrow" colSpan={canEdit ? 6 : 5}>No hay productos que coincidan con la búsqueda.</td>
              </tr>
            )}
            {filtered.map((p) => {
              const reutil = p.type === "REUTILIZABLE";
              return (
                <tr key={p.id} className={p.active ? undefined : "row-baja"}>
                  <td>
                    <div className="prod">{p.name}</div>
                    <div className="rubro">
                      {nombreDeCategoria(p.category)}{p.rubro ? ` · ${p.rubro}` : ""}
                      {p.description ? ` · ${p.description}` : ""}
                    </div>
                  </td>
                  <td>{reutil ? "Reutilizable" : "Consumible"}</td>
                  <td>{p.unit}</td>
                  <td>
                    {reutil ? (
                      <span className="stocknum">{p.stock}</span>
                    ) : (
                      <span className="stocknum dim">—</span>
                    )}
                  </td>
                  <td>
                    {!p.active ? (
                      <span className="chip crit">Dado de baja</span>
                    ) : !reutil ? (
                      <span className="chip neutral">Se compra por evento</span>
                    ) : p.stock === null ? (
                      // Nunca se contó. No es "hay cero": es que no se sabe.
                      <span className="chip warn">{IconWarn}Sin contar</span>
                    ) : p.stock > 0 ? (
                      <span className="chip ok">{IconCheck}Cargado</span>
                    ) : (
                      <span className="chip neutral">Contado: no hay</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="rowacts">
                      <RowMenu
                        label={`Opciones de ${p.name}`}
                        items={[
                          ...(reutil ? [{ label: "Editar stock", onSelect: () => setEditing(p) }] : []),
                          { label: "Administrar producto", onSelect: () => setAdmin(p) },
                        ]}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="hint">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>
        {canEdit
          ? "Al editar el stock podés poner el total nuevo o sumar/restar, anotando el motivo (rotura, pérdida o compra). Las bebidas no llevan stock: solo se listan en el pedido."
          : "Este es el stock disponible en el depósito. Las bebidas no llevan stock: solo se listan en el pedido."}
      </div>

      {editing && (
        <EditStockModal
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={(newStock) => handleSaved(editing.id, newStock)}
        />
      )}
      {admin && (
        <ProductAdminModal
          product={admin}
          onClose={() => setAdmin(null)}
          onChanged={() => {
            setAdmin(null);
            router.refresh();
          }}
        />
      )}
      {creating && (
        <NewProductModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            // Recarga desde el servidor: el producto nuevo tiene que aparecer
            // ordenado por categoría y rubro como todos los demás.
            router.refresh();
          }}
        />
      )}
    </>
  );
}

const REASONS = [
  { v: "COMPRA", l: "Compra / ingreso" },
  { v: "ROTURA", l: "Rotura" },
  { v: "PERDIDA", l: "Pérdida" },
  { v: "AJUSTE", l: "Ajuste / conteo" },
];

function EditStockModal({
  product,
  onClose,
  onSaved,
}: {
  product: Product;
  onClose: () => void;
  onSaved: (newStock: number) => void;
}) {
  const [val, setVal] = useState<string>(String(product.stock));
  const [reason, setReason] = useState("AJUSTE");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bloquea el scroll del fondo mientras el modal está abierto
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const parsed = val.trim() === "" ? NaN : Math.round(Number(val));
  const valid = Number.isFinite(parsed) && parsed >= 0;
  // Sin recuento previo se parte de cero para poder escribir el primero.
  const previo = product.stock ?? 0;
  const total = valid ? parsed : previo;
  const delta = total - previo;

  function step(d: number) {
    // updater funcional: clicks rápidos seguidos acumulan correctamente
    setVal((prev) => {
      const n = prev.trim() === "" ? previo : Math.round(Number(prev));
      const base = Number.isFinite(n) ? n : previo;
      return String(Math.max(0, base + d));
    });
  }

  async function save() {
    if (!valid) {
      setError("Ingresá una cantidad válida.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await updateStock({
      productId: product.id,
      newStock: total,
      reason,
      note,
    });
    setSaving(false);
    if (res.ok && typeof res.newStock === "number") {
      onSaved(res.newStock);
    } else {
      setError(res.error ?? "No se pudo guardar. Probá de nuevo.");
    }
  }

  const unit = product.unit.toLowerCase();
  const deltaText = !valid
    ? "Ingresá un número"
    : delta === 0
      ? "Sin cambios"
      : delta > 0
        ? `Sumás ${delta} ${unit}`
        : `Restás ${Math.abs(delta)} ${unit}`;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Editar stock</h2>
        <div className="msub">
          {product.name} · stock actual: <span className="stockbig">{product.stock}</span> {unit}
        </div>

        <div className="stepper-row">
          <button type="button" className="step-btn" onClick={() => step(-1)} aria-label="Restar uno">−</button>
          <input
            className="step-input"
            type="number"
            inputMode="numeric"
            min={0}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            aria-label="Cantidad total"
            autoFocus
          />
          <button type="button" className="step-btn" onClick={() => step(1)} aria-label="Sumar uno">+</button>
        </div>
        <div className={`delta-line${delta !== 0 && valid ? " active" : ""}`}>{deltaText}</div>

        <div className="field">
          <label>Motivo</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => (
              <option key={r.v} value={r.v}>{r.l}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Nota (opcional)</label>
          <input
            type="text"
            placeholder="Aclaración…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && <div className="preview-line" style={{ color: "var(--crit)" }}>{error}</div>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={save} disabled={saving || !valid}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
