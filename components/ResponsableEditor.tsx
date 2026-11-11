"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setEventResponsable } from "@/app/actions/period";
import { intentar } from "@/lib/actualizacion";
import { MensajeDeError } from "@/components/Formulario";
import { IconPerson } from "@/components/iconos";

/** Cambiar el responsable del evento. Es lo único que puede escribir el
 *  encargado de logística, así que va como su propio control y no metido entre
 *  los del pedido. */
export function ResponsableEditor({
  eventId,
  responsable,
  canEdit,
}: {
  eventId: string;
  responsable: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(responsable ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    const res = await intentar(() => setEventResponsable(eventId, valor));
    setGuardando(false);
    if (!res.ok) return setError(res.error ?? "No se pudo guardar.");
    setEditando(false);
    router.refresh();
  }

  function cancelar() {
    setValor(responsable ?? "");
    setError(null);
    setEditando(false);
  }

  if (!canEdit) {
    return (
      <span className="resp-chip">
        {IconPerson}
        <span>{responsable || "Sin responsable"}</span>
      </span>
    );
  }

  if (!editando) {
    return (
      <button className="resp-chip resp-chip-btn" onClick={() => setEditando(true)} type="button" title="Cambiar el responsable del evento">
        {IconPerson}
        <span>{responsable || "Sin responsable"}</span>
        <span className="resp-cta">Cambiar</span>
      </button>
    );
  }

  return (
    <div className="resp-edit">
      <input
        type="text"
        value={valor}
        autoFocus
        placeholder="Nombre del responsable"
        aria-label="Responsable del evento"
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          // preventDefault: adentro de una ventana, Enter no manda otro
          // formulario y Escape cancela esta edición sin cerrar la ventana.
          if (e.key === "Enter") {
            e.preventDefault();
            void guardar();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancelar();
          }
        }}
      />
      <button type="button" className="btn primary" onClick={guardar} disabled={guardando}>
        {guardando ? "Guardando…" : "Guardar"}
      </button>
      <button type="button" className="btn ghost" onClick={cancelar} disabled={guardando}>Cancelar</button>
      {error && <MensajeDeError>{error}</MensajeDeError>}
    </div>
  );
}
