"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setSuggestionStatus, replyToSuggestion } from "@/app/actions/suggestions";
import { SUGGESTION_STATUSES, STATUS_LABEL, LIMITS } from "@/lib/suggestions";

/** Los controles de la administradora: estado y respuesta. Solo se renderiza
 *  para quien puede gestionar — y aun así el servidor lo vuelve a comprobar. */
export function SuggestionAdmin({
  id,
  status,
  reply,
}: {
  id: string;
  status: string;
  reply: string | null;
}) {
  const router = useRouter();
  const [guardando, setGuardando] = useState(false);
  const [texto, setTexto] = useState(reply ?? "");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function cambiarEstado(nuevo: string) {
    setError(null);
    setOk(null);
    setGuardando(true);
    const r = await setSuggestionStatus(id, nuevo);
    setGuardando(false);
    if (!r.ok) return setError(r.error ?? "No se pudo cambiar el estado.");
    setOk(`Estado: ${STATUS_LABEL[nuevo] ?? nuevo}`);
    router.refresh();
  }

  async function responder() {
    if (guardando) return;
    setError(null);
    setOk(null);
    if (!texto.trim()) return setError("La respuesta no puede quedar vacía.");
    setGuardando(true);
    const r = await replyToSuggestion(id, texto);
    setGuardando(false);
    if (!r.ok) return setError(r.error ?? "No se pudo guardar la respuesta.");
    setOk("Respuesta enviada. Le llega un aviso a quien la mandó.");
    router.refresh();
  }

  return (
    <section className="sug-block sug-admin">
      <div className="section-title">Gestionar</div>

      <div className="field">
        <label htmlFor="sug-estado">Estado</label>
        <select
          id="sug-estado"
          value={status}
          disabled={guardando}
          onChange={(e) => cambiarEstado(e.target.value)}
        >
          {SUGGESTION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="sug-resp">{reply ? "Editar la respuesta" : "Responder"}</label>
        <textarea
          id="sug-resp"
          rows={4}
          value={texto}
          maxLength={LIMITS.reply}
          placeholder="Contale qué se va a hacer, o por qué no."
          onChange={(e) => setTexto(e.target.value)}
        />
      </div>

      <div className="modal-actions">
        <button className="btn primary" onClick={responder} disabled={guardando}>
          {guardando ? "Guardando…" : reply ? "Guardar respuesta" : "Enviar respuesta"}
        </button>
      </div>

      {error && <div className="login-error">{error}</div>}
      {ok && <div className="settings-ok">✓ {ok}</div>}
    </section>
  );
}
