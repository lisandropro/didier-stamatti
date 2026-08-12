"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setEventResponsable } from "@/app/actions/period";

const IconPerson = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20a8 8 0 0 1 16 0" />
  </svg>
);

/** Cambiar el responsable de la fiesta. Es lo único que puede escribir el
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
    const res = await setEventResponsable(eventId, valor);
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
      <button className="resp-chip resp-chip-btn" onClick={() => setEditando(true)} title="Cambiar el responsable de la fiesta">
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
        aria-label="Responsable de la fiesta"
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") guardar();
          if (e.key === "Escape") cancelar();
        }}
      />
      <button className="btn primary" onClick={guardar} disabled={guardando}>
        {guardando ? "Guardando…" : "Guardar"}
      </button>
      <button className="btn ghost" onClick={cancelar} disabled={guardando}>Cancelar</button>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
