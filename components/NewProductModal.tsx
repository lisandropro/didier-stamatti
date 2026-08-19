"use client";

import { useEffect, useState } from "react";
import { createProduct, listRubros } from "@/app/actions/products";

import { OPCIONES_CATEGORIA as CATS } from "@/lib/categories";

// Unidades que ya se usan en el catálogo, para no inventar variantes nuevas.
const UNITS = ["Unidad", "Juego", "Módulo", "Caja", "Cajón", "Pack", "Paquete", "Bolsa", "Botella", "Lata", "Litro", "Kg"];

export function NewProductModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("ENSERES");
  const [rubro, setRubro] = useState("");
  const [type, setType] = useState("REUTILIZABLE");
  const [unit, setUnit] = useState("Unidad");
  const [stock, setStock] = useState("0");
  const [rubros, setRubros] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    let vivo = true;
    listRubros().then((r) => vivo && setRubros(r));
    return () => {
      vivo = false;
    };
  }, []);

  /** Cambiar de categoría reacomoda el resto: la bebida no lleva stock (se
   *  compra para cada evento) y los rubros son distintos en cada una. */
  function cambiarCategoria(nueva: string) {
    setCategory(nueva);
    setType(nueva === "BEBIDA" ? "CONSUMIBLE" : "REUTILIZABLE");
    setRubro("");
  }

  const llevaStock = type === "REUTILIZABLE";
  const parsed = stock.trim() === "" ? 0 : Math.round(Number(stock));
  const stockValido = Number.isFinite(parsed) && parsed >= 0;
  const valido = name.trim().length > 0 && (!llevaStock || stockValido);

  async function save() {
    if (!valido) return;
    setSaving(true);
    setError(null);
    const res = await createProduct({
      name,
      description,
      category,
      rubro,
      type,
      unit,
      stock: llevaStock ? parsed : 0,
    });
    setSaving(false);
    if (!res.ok) return setError(res.error ?? "No se pudo crear el producto.");
    onCreated();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Nuevo producto</h2>
        <p className="modal-sub">Se agrega al catálogo y queda disponible para todos los pedidos.</p>

        <div className="form-grid">
          <div className="field field-full">
            <label>Nombre</label>
            <input
              type="text"
              value={name}
              autoFocus
              placeholder="Ej: Copa de vino"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field field-full">
            <label>Descripción <em className="opt">(opcional)</em></label>
            <input
              type="text"
              value={description}
              placeholder="Para distinguirlo de otro parecido. Ej: la de pie alto, borde dorado"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Categoría</label>
            <select value={category} onChange={(e) => cambiarCategoria(e.target.value)}>
              {CATS.map((c) => (
                <option key={c.v} value={c.v}>{c.l}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Rubro <em className="opt">(dónde se guarda)</em></label>
            <input
              type="text"
              list="rubros-existentes"
              value={rubro}
              placeholder="Ej: Copas y vasos"
              onChange={(e) => setRubro(e.target.value)}
            />
            <datalist id="rubros-existentes">
              {(rubros[category] ?? []).map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>

          <div className="field">
            <label>Unidad</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Control de stock</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="REUTILIZABLE">Sí, se cuenta y se devuelve</option>
              <option value="CONSUMIBLE">No, se compra para cada evento</option>
            </select>
          </div>

          {llevaStock && (
            <div className="field">
            <label>Cantidad disponible</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={stock}
                onChange={(e) => setStock(e.target.value)}
              />
          </div>
          )}
        </div>

        {llevaStock && parsed > 0 && (
          <p className="modal-sub">
            Se va a registrar un movimiento de <b>+{parsed}</b> en el historial, para que la cantidad inicial quede explicada.
          </p>
        )}
        {!llevaStock && (
          <p className="modal-sub">Los consumibles no llevan stock: aparecen en el pedido pero no se cuentan.</p>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={save} disabled={saving || !valido}>
            {saving ? "Creando…" : "Crear producto"}
          </button>
        </div>
      </div>
    </div>
  );
}
