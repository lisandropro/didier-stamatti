"use client";

import { useEffect, useState } from "react";
import {
  updateProduct,
  setProductActive,
  deleteProduct,
  getProductHistory,
  listRubros,
  type HistoryEntry,
} from "@/app/actions/products";

export type AdminProduct = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  rubro: string | null;
  type: string;
  unit: string;
  stock: number | null;
  active: boolean;
};

import { OPCIONES_CATEGORIA as CATS } from "@/lib/categories";
const UNITS = ["Unidad", "Juego", "Módulo", "Caja", "Cajón", "Pack", "Paquete", "Bolsa", "Botella", "Lata", "Litro", "Kg"];

function fecha(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ProductAdminModal({
  product,
  onClose,
  onChanged,
}: {
  product: AdminProduct;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? "");
  const [category, setCategory] = useState(product.category);
  const [rubro, setRubro] = useState(product.rubro ?? "");
  const [type, setType] = useState(product.type);
  const [unit, setUnit] = useState(product.unit);

  const [rubros, setRubros] = useState<Record<string, string[]>>({});
  const [historia, setHistoria] = useState<HistoryEntry[] | null>(null);
  const [verHistoria, setVerHistoria] = useState(false);
  const [confirmar, setConfirmar] = useState<null | "eliminar" | "tipo">(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

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

  const cambioDeTipo = type !== product.type;
  const cambioDeNombre = name.trim() !== product.name;
  const hayCambios =
    cambioDeNombre ||
    (description.trim() || null) !== (product.description ?? null) ||
    category !== product.category ||
    (rubro.trim() || null) !== (product.rubro ?? null) ||
    cambioDeTipo ||
    unit !== product.unit;

  async function guardar() {
    // Cambiar el tipo altera si el producto se cuenta o no: se avisa antes.
    if (cambioDeTipo && confirmar !== "tipo") return setConfirmar("tipo");
    setSaving(true);
    setError(null);
    const res = await updateProduct({ id: product.id, name, description, category, rubro, type, unit });
    setSaving(false);
    setConfirmar(null);
    if (!res.ok) return setError(res.error ?? "No se pudo guardar.");
    onChanged();
  }

  async function alternarEstado() {
    setSaving(true);
    setError(null);
    const res = await setProductActive(product.id, !product.active);
    setSaving(false);
    if (!res.ok) return setError(res.error ?? "No se pudo cambiar el estado.");
    onChanged();
  }

  async function eliminar() {
    setSaving(true);
    setError(null);
    const res = await deleteProduct(product.id);
    setSaving(false);
    if (!res.ok) return setError(res.error ?? "No se pudo eliminar.");
    if (res.baja === "logica") {
      // No se borró: tenía historia. Se explica en vez de mentir que se borró.
      setAviso(
        `No se eliminó del todo porque tiene ${res.pedidos} ${res.pedidos === 1 ? "pedido" : "pedidos"} y ` +
          `${res.movimientos} ${res.movimientos === 1 ? "movimiento" : "movimientos"} asociados. ` +
          `Se dio de baja: deja de ofrecerse al armar pedidos, pero no se rompe nada de lo anterior.`
      );
      setConfirmar(null);
      return;
    }
    onChanged();
  }

  async function abrirHistoria() {
    setVerHistoria(true);
    if (historia === null) setHistoria(await getProductHistory(product.id));
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Administrar producto</h2>
        <p className="modal-sub">
          {product.name}
          {!product.active && <span className="chip warn" style={{ marginLeft: 8 }}>Dado de baja</span>}
        </p>

        {aviso && <div className="banner ok" style={{ marginBottom: "var(--sp-4)" }}><div><p>{aviso}</p></div></div>}

        <div className="form-grid">
          <div className="field field-full">
            <label>Nombre</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field field-full">
            <label>Descripción <em className="opt">(opcional)</em></label>
            <input type="text" value={description} placeholder="Para distinguirlo de otro parecido" onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label>Categoría</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Rubro</label>
            <input type="text" list="rubros-admin" value={rubro} onChange={(e) => setRubro(e.target.value)} />
            <datalist id="rubros-admin">
              {(rubros[category] ?? []).map((r) => <option key={r} value={r} />)}
            </datalist>
          </div>
          <div className="field">
            <label>Unidad</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Control de stock</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="REUTILIZABLE">Sí, se cuenta y se devuelve</option>
              <option value="CONSUMIBLE">No, se compra para cada evento</option>
            </select>
          </div>
        </div>

        {cambioDeNombre && (
          <p className="modal-sub">
            Cambiar el nombre <b>no rompe los pedidos anteriores</b>: quedan enganchados al producto, no al texto. Sí van a
            mostrar el nombre nuevo si volvés a imprimirlos.
          </p>
        )}

        <div className="admin-row">
          <div>
            <b>
              Cantidad disponible:{" "}
              {product.type !== "REUTILIZABLE"
                ? "no se cuenta"
                : product.stock === null
                  ? "sin contar todavía"
                  : product.stock}
            </b>
            <p className="trash-meta">Se ajusta desde &quot;Editar stock&quot;, para que quede registrado el motivo.</p>
          </div>
          <button className="btn ghost" onClick={abrirHistoria}>Ver historial</button>
        </div>

        <div className="admin-row">
          <div>
            <b>{product.active ? "Producto activo" : "Producto dado de baja"}</b>
            <p className="trash-meta">
              {product.active
                ? "Se ofrece al armar pedidos."
                : "No se ofrece al armar pedidos. Su stock y su historial siguen intactos."}
            </p>
          </div>
          <button className="btn ghost" onClick={alternarEstado} disabled={saving}>
            {product.active ? "Dar de baja" : "Reactivar"}
          </button>
        </div>

        <div className="admin-row danger-row">
          <div>
            <b>Eliminar del catálogo</b>
            <p className="trash-meta">
              Si tiene pedidos o movimientos, no se borra: se da de baja para no romper el historial.
            </p>
          </div>
          <button className="btn btn-del" onClick={() => setConfirmar("eliminar")} disabled={saving}>Eliminar</button>
        </div>

        {confirmar === "eliminar" && (
          <div className="form-error">
            <p>¿Seguro? Si nunca se usó, el producto desaparece del catálogo y no se puede deshacer.</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setConfirmar(null)} disabled={saving}>No</button>
              <button className="btn danger" onClick={eliminar} disabled={saving}>Sí, eliminar</button>
            </div>
          </div>
        )}

        {confirmar === "tipo" && (
          <div className="form-error">
            <p>
              {type === "CONSUMIBLE"
                ? `Va a dejar de contarse: no aparece más en los avisos de falta de stock. La cantidad (${product.stock ?? "sin contar"}) se conserva y vuelve si lo pasás de nuevo a reutilizable.`
                : "Va a empezar a contarse y a sumar en los avisos de falta de stock."}
            </p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setConfirmar(null)} disabled={saving}>Cancelar</button>
              <button className="btn danger" onClick={guardar} disabled={saving}>Sí, cambiar</button>
            </div>
          </div>
        )}

        {verHistoria && (
          <>
            <div className="section-title">Historial</div>
            <div className="trash-list">
              {historia === null && <p className="trash-meta">Cargando…</p>}
              {historia?.length === 0 && <p className="trash-meta">Todavía no hay cambios registrados.</p>}
              {historia?.map((h) => (
                <div className="trash-item" key={h.id}>
                  <div>
                    <b>{h.label}</b>
                    <div className="trash-meta">
                      {h.kind === "dato"
                        ? `${h.before ?? "—"} → ${h.after ?? "—"}`
                        : `${h.after} unidades${h.note ? ` · ${h.note}` : ""}`}
                    </div>
                  </div>
                  <span className="trash-meta">{h.actorName ?? "—"} · {fecha(h.at)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cerrar</button>
          <button className="btn primary" onClick={guardar} disabled={saving || !hayCambios}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
