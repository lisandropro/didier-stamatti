"use client";

import { useMemo, useState } from "react";
import { validQuantity, MAX_QUANTITY } from "@/lib/quantity";
import { updateStock } from "@/app/actions/stock";
import { NewProductModal } from "@/components/NewProductModal";
import { ProductAdminModal } from "@/components/ProductAdminModal";
import { RowMenu } from "@/components/RowMenu";
import { OPCIONES_CATEGORIA, nombreDeCategoria } from "@/lib/categories";
import { useRouter } from "next/navigation";
import { Dialogo } from "@/components/Dialogo";
import { Campo, MensajeDeError } from "@/components/Formulario";
import { IconAviso, IconCheck, IconInfo, IconPlus, IconSearch } from "@/components/iconos";
import { MOTIVOS_DE_STOCK, norm, sinRueda } from "@/components/util";

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

export function InventoryTable({ products, canEdit }: { products: Product[]; canEdit: boolean }) {
  const items = products;
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

  function handleSaved() {
    setEditing(null);
    router.refresh();
  }

  return (
    <>
      <div className="searchbar">
        <label className="search">
          {IconSearch}
          <input
            aria-label="Buscar producto"
            enterKeyHint="search"
            placeholder="Buscar producto… (ej. copa, silla, plato)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {/* En el celular las pestañas van en una sola fila que se desliza: apiladas
            en dos líneas empujaban la lista hacia abajo. */}
        <div className="filtros-scroll">
          {CATS.map((c) => (
            <button
              key={c.v}
              type="button"
              className={`tab${cat === c.v ? " active" : ""}`}
              aria-pressed={cat === c.v}
              onClick={() => setCat(c.v)}
            >
              {c.l}
            </button>
          ))}
        </div>
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
        <table className="inventory-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Tipo</th>
              <th>Unidad</th>
              <th>Stock</th>
              <th>Estado</th>
              {canEdit && <th><span className="sr-only">Acciones</span></th>}
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
                    <div className="inventory-mobile-meta">
                      {reutil ? "Reutilizable" : "Consumible"} · {p.unit}
                      <br />
                      {!p.active ? "Dado de baja" : !reutil ? "Se compra por evento" : p.stock === null ? "Sin contar" : p.stock === 0 ? "Contado: no hay" : "Contado"}
                    </div>
                  </td>
                  <td>{reutil ? "Reutilizable" : "Consumible"}</td>
                  <td>{p.unit}</td>
                  <td>
                    {reutil ? (
                      <span className="stocknum">{p.stock ?? "—"}</span>
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
                      <span className="chip warn">{IconAviso}Sin contar</span>
                    ) : p.stock > 0 ? (
                      <span className="chip ok">{IconCheck}Contado</span>
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
        {IconInfo}
        {canEdit
          ? "Al editar el stock podés poner el total nuevo o sumar/restar, anotando el motivo (rotura, pérdida o compra). Las bebidas no llevan stock: solo se listan en el pedido."
          : "Este es el stock disponible en el depósito. Las bebidas no llevan stock: solo se listan en el pedido."}
      </div>

      {editing && (
        <EditStockModal
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
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

function EditStockModal({
  product,
  onClose,
  onSaved,
}: {
  product: Product;
  onClose: () => void;
  onSaved: (newStock: number) => void;
}) {
  const [val, setVal] = useState<string>(product.stock === null ? "" : String(product.stock));
  const [reason, setReason] = useState("AJUSTE");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = val.trim() === "" ? NaN : Number(val);
  const valid = validQuantity(parsed);
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
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
    const res = await updateStock({
      productId: product.id,
      newStock: total,
      expectedStock: product.stock,
      reason,
      note,
    });
    if (res.ok && typeof res.newStock === "number") {
      onSaved(res.newStock);
    } else {
      setError(res.error ?? "No se pudo guardar. Probá de nuevo.");
    }
    } catch {
      setError("No se pudo confirmar el guardado. Revisá la conexión y volvé a intentar.");
    } finally { setSaving(false); }
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
    <Dialogo
      titulo="Editar stock"
      onCerrar={onClose}
      ocupado={saving}
      cambiado={(valid && delta !== 0) || note.trim() !== ""}
      sinDeslizar
      alEnviar={save}
    >
      <div className="msub">
        {product.name} · stock actual: {product.stock ?? "Sin contar"} {unit}
      </div>

      <div className="stepper-row">
        <button type="button" className="step-btn" disabled={saving} onClick={() => step(-1)} aria-label="Restar uno">−</button>
        <input
          className="step-input"
          type="number"
          onWheel={sinRueda}
          inputMode="numeric"
          min={0}
          max={MAX_QUANTITY}
          step={1}
          disabled={saving}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          aria-label="Cantidad total"
          autoFocus
        />
        <button type="button" className="step-btn" disabled={saving} onClick={() => step(1)} aria-label="Sumar uno">+</button>
      </div>
      {/* Se anuncia al cambiar: quien no ve la pantalla escucha "Sumás 3 unidad". */}
      <div className={`delta-line${delta !== 0 && valid ? " active" : ""}`} aria-live="polite">{deltaText}</div>

      <Campo label="Motivo">
        <select disabled={saving} value={reason} onChange={(e) => setReason(e.target.value)}>
          {MOTIVOS_DE_STOCK.map((r) => (
            <option key={r.v} value={r.v}>{r.detalle}</option>
          ))}
        </select>
      </Campo>

      <Campo label="Nota (opcional)">
        <input
          type="text"
          placeholder="Aclaración…"
          maxLength={1000}
          disabled={saving}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Campo>

      {error && <MensajeDeError>{error}</MensajeDeError>}

      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" className="btn primary" disabled={saving || !valid}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </Dialogo>
  );
}
