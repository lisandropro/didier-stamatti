"use client";

import { useState } from "react";
import { intentar } from "@/lib/actualizacion";
import { deleteEvent } from "@/app/actions/period";

/** Confirmación para mandar un evento a la papelera. Vive en el editor del
 *  pedido: en la tarjeta de la portada estaba pegada a "Armar pedido", y en el
 *  celular un dedo apurado podía tocarla en vez de abrir el pedido. */
export function ConfirmDeleteEvent({
  evento,
  onClose,
  onDeleted,
}: {
  evento: { id: string; lugar: string; lineCount: number };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setSaving(true);
    setErr(null);
    const res = await intentar(() => deleteEvent(evento.id));
    setSaving(false);
    if (!res.ok) return setErr(res.error ?? "No se pudo borrar.");
    onDeleted();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()}>
        <h2>¿Borrar el evento de {evento.lugar}?</h2>
        <p className="modal-sub">
          {evento.lineCount > 0
            ? `Se va a la papelera junto con sus ${evento.lineCount} producto${evento.lineCount > 1 ? "s" : ""} del pedido.`
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
