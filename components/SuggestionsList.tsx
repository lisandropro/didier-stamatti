"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  SUGGESTION_KINDS,
  SUGGESTION_STATUSES,
  KIND_SHORT,
  STATUS_LABEL,
  STATUS_CLASS,
} from "@/lib/suggestions";

type Item = {
  id: string;
  kind: string;
  title: string;
  status: string;
  authorName: string;
  eventLugar: string | null;
  tieneRespuesta: boolean;
  at: string;
};

export function SuggestionsList({
  items,
  admin,
  tipo,
  estado,
}: {
  items: Item[];
  admin: boolean;
  tipo: string | null;
  estado: string | null;
}) {
  const router = useRouter();

  // Los filtros viajan en la dirección: así se puede compartir o recargar sin
  // que se pierdan, y el filtrado de verdad lo hace el servidor.
  function filtrar(clave: "tipo" | "estado", valor: string) {
    const q = new URLSearchParams();
    const nuevo = { tipo, estado, [clave]: valor || null } as Record<string, string | null>;
    if (nuevo.tipo) q.set("tipo", nuevo.tipo);
    if (nuevo.estado) q.set("estado", nuevo.estado);
    const s = q.toString();
    router.push(s ? `/sugerencias?${s}` : "/sugerencias");
  }

  const hayFiltro = Boolean(tipo || estado);

  return (
    <>
      <div className="sug-filters">
        <label>
          <span>Tipo</span>
          <select value={tipo ?? ""} onChange={(e) => filtrar("tipo", e.target.value)}>
            <option value="">Todos</option>
            {SUGGESTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_SHORT[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Estado</span>
          <select value={estado ?? ""} onChange={(e) => filtrar("estado", e.target.value)}>
            <option value="">Todos</option>
            {SUGGESTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {hayFiltro && (
          <Link className="btn ghost" href="/sugerencias">
            Quitar filtros
          </Link>
        )}
        <span className="spacer" />
        <span className="countnote">
          {items.length} {items.length === 1 ? "sugerencia" : "sugerencias"}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="empty-card">
          <p className="empty-title">
            {hayFiltro ? "Ninguna sugerencia con esos filtros" : "Todavía no hay sugerencias"}
          </p>
          <p>
            {hayFiltro
              ? "Probá quitando alguno."
              : admin
                ? "Cuando alguien del equipo mande una, la vas a ver acá."
                : "Usá “Enviar sugerencia” para contar qué te falta o qué no anda."}
          </p>
        </div>
      ) : (
        <div className="sug-list">
          {items.map((s) => (
            <Link key={s.id} className="sug-row" href={`/sugerencias/${s.id}`}>
              <span className="sug-row-top">
                <span className={`chip ${STATUS_CLASS[s.status] ?? "neutral"}`}>
                  {STATUS_LABEL[s.status] ?? s.status}
                </span>
                <span className="chip neutral">{KIND_SHORT[s.kind] ?? s.kind}</span>
                {s.tieneRespuesta && <span className="chip ok">Respondida</span>}
              </span>
              <span className="sug-row-title">{s.title}</span>
              <span className="sug-row-meta">
                {admin ? `${s.authorName} · ` : ""}
                {s.at}
                {s.eventLugar ? ` · sobre ${s.eventLugar}` : ""}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
