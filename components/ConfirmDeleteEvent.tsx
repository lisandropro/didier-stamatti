"use client";

import { useState } from "react";
import { intentar } from "@/lib/actualizacion";
import { deleteEvent } from "@/app/actions/period";
import { Dialogo } from "@/components/Dialogo";
import { MensajeDeError } from "@/components/Formulario";

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
    if (!res.ok) {
      setSaving(false);
      return setErr(res.error ?? "No se pudo borrar.");
    }
    // Queda en "Borrando…" hasta que la navegación termine: con un teléfono
    // lento, el modal seguía con los botones activos sobre un evento ya borrado.
    onDeleted();
  }

  return (
    // `ocupado`: tocar afuera (o Escape) mientras dice "Borrando…" cerraba el
    // modal con el borrado en curso.
    <Dialogo titulo={<>¿Borrar el evento de {evento.lugar}?</>} onCerrar={onClose} ocupado={saving}>
      <p className="modal-sub">
        {evento.lineCount > 0
          ? `Se va a la papelera junto con sus ${evento.lineCount} producto${evento.lineCount > 1 ? "s" : ""} del pedido.`
          : "Todavía no tiene pedido cargado."}{" "}
        El resto del período no se toca, y lo podés recuperar desde la papelera.
      </p>
      {err && <MensajeDeError>{err}</MensajeDeError>}
      <div className="modal-actions">
        {/* El foco arranca en Cancelar: un Enter de más no borra nada. */}
        <button type="button" className="btn ghost" onClick={onClose} disabled={saving} autoFocus>Cancelar</button>
        <button type="button" className="btn danger" onClick={confirm} disabled={saving}>
          {saving ? "Borrando…" : "Borrar evento"}
        </button>
      </div>
    </Dialogo>
  );
}
