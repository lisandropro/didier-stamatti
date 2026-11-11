"use client";

import { useEffect, useState } from "react";
import { createProduct, listRubros } from "@/app/actions/products";

import { OPCIONES_CATEGORIA as CATS } from "@/lib/categories";
import { intentar } from "@/lib/actualizacion";
import { Dialogo } from "@/components/Dialogo";
import { Campo, MensajeDeError } from "@/components/Formulario";
import { sinRueda, UNIDADES } from "@/components/util";

export function NewProductModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("ENSERES");
  const [rubro, setRubro] = useState("");
  const [type, setType] = useState("REUTILIZABLE");
  const [unit, setUnit] = useState("Unidad");
  const [stock, setStock] = useState("");
  const [rubros, setRubros] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    // Los rubros son solo sugerencias del campo: si no llegan, se escribe a mano.
    listRubros().then((r) => vivo && setRubros(r)).catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  /** Cambiar de sector reacomoda el resto: la bebida no lleva stock (se
   *  compra para cada evento) y los rubros son distintos en cada uno. */
  function cambiarCategoria(nueva: string) {
    setCategory(nueva);
    setType(nueva === "BEBIDA" ? "CONSUMIBLE" : "REUTILIZABLE");
    setRubro("");
  }

  const llevaStock = type === "REUTILIZABLE";
  // Vacío = no se contó todavía. Es un estado válido y distinto de cero.
  const sinContar = stock.trim() === "";
  const parsed = sinContar ? null : Math.round(Number(stock));
  const stockValido = sinContar || (Number.isFinite(parsed) && parsed! >= 0);
  const valido = name.trim().length > 0 && (!llevaStock || stockValido);

  async function save() {
    if (!valido || saving) return;
    setSaving(true);
    setError(null);
    const res = await intentar(() => createProduct({
      name,
      description,
      category,
      rubro,
      type,
      unit,
      stock: llevaStock ? parsed : 0,
    }));
    setSaving(false);
    if (!res.ok) return setError(res.error ?? "No se pudo crear el producto.");
    onCreated();
  }

  return (
    <Dialogo
      titulo="Nuevo producto"
      onCerrar={onClose}
      ocupado={saving}
      cambiado={Boolean(name || description || rubro || stock)}
      sinDeslizar
      ancho="wide"
      alEnviar={save}
    >
      <p className="modal-sub">Se agrega al catálogo y queda disponible para todos los pedidos.</p>

      <div className="form-grid">
        <Campo label="Nombre" className="field-full">
          <input
            type="text"
            value={name}
            autoFocus
            placeholder="Ej: Copa de vino"
            onChange={(e) => setName(e.target.value)}
          />
        </Campo>

        <Campo label={<>Descripción <em className="opt">(opcional)</em></>} className="field-full">
          <input
            type="text"
            value={description}
            placeholder="Para distinguirlo de otro parecido. Ej: la de pie alto, borde dorado"
            onChange={(e) => setDescription(e.target.value)}
          />
        </Campo>

        <Campo label="Sector">
          <select value={category} onChange={(e) => cambiarCategoria(e.target.value)}>
            {CATS.map((c) => (
              <option key={c.v} value={c.v}>{c.l}</option>
            ))}
          </select>
        </Campo>

        <Campo label={<>Rubro <em className="opt">(dónde se guarda)</em></>}>
          {(id) => (
            <>
              <input
                id={id}
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
            </>
          )}
        </Campo>

        <Campo label="Unidad">
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNIDADES.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </Campo>

        <Campo label="Control de stock">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="REUTILIZABLE">Sí, se cuenta y se devuelve</option>
            <option value="CONSUMIBLE">No, se compra para cada evento</option>
          </select>
        </Campo>

        {llevaStock && (
          <Campo label="Cantidad disponible">
            <input
              type="number"
              onWheel={sinRueda}
              inputMode="numeric"
              min={0}
              placeholder="dejalo vacío si todavía no se contó"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
            />
          </Campo>
        )}
      </div>

      {llevaStock && sinContar && (
        <p className="modal-sub">
          Va a quedar como <b>sin contar</b>. No es lo mismo que cero: hasta que alguien lo
          cuente no va a avisar que falta, y va a aparecer en la lista de lo que hay que contar.
        </p>
      )}
      {llevaStock && parsed !== null && parsed > 0 && (
        <p className="modal-sub">
          Se va a registrar un movimiento de <b>+{parsed}</b> en el historial, para que la cantidad inicial quede explicada.
        </p>
      )}
      {!llevaStock && (
        <p className="modal-sub">Los consumibles no llevan stock: aparecen en el pedido pero no se cuentan.</p>
      )}

      {error && <MensajeDeError>{error}</MensajeDeError>}

      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" className="btn primary" disabled={saving || !valido}>
          {saving ? "Creando…" : "Crear producto"}
        </button>
      </div>
    </Dialogo>
  );
}
