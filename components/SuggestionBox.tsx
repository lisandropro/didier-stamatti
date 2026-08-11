"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createSuggestion } from "@/app/actions/suggestions";
import { SUGGESTION_KINDS, KIND_LABEL, LIMITS, screenLabel } from "@/lib/suggestions";

/**
 * El formulario de sugerencias, en un modal.
 *
 * Vive una sola vez, en el armazón de la app, y se abre con un evento del
 * navegador (`abrir-sugerencia`) que disparan el menú lateral y la barra de
 * abajo. Podría pasarse por props, pero eso obligaría a que el menú conozca al
 * formulario: con el evento cada uno sigue sin saber del otro, y es el mismo
 * mecanismo que ya usa la campana de avisos.
 */
export function SuggestionBox() {
  const [abierto, setAbierto] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const abrir = () => setAbierto(true);
    window.addEventListener("abrir-sugerencia", abrir);
    return () => window.removeEventListener("abrir-sugerencia", abrir);
  }, []);

  if (!abierto) return null;
  return <Formulario pathname={pathname} onClose={() => setAbierto(false)} />;
}

function Formulario({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  const [kind, setKind] = useState<string>("AGREGAR");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [contextNote, setContextNote] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  // Una llave por redacción: la misma en todos los reintentos. Es lo que hace
  // que un doble toque, o un reenvío al volver la señal, no cree dos.
  //
  // Se arma al primer envío y no al construir el formulario: sortear un número
  // es una operación impura y durante el render React puede repetirla, lo que
  // daría dos llaves distintas y, con ellas, dos sugerencias iguales.
  const clientKey = useRef<string | null>(null);
  function llave(): string {
    if (!clientKey.current) {
      clientKey.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    }
    return clientKey.current;
  }

  // Se congela la pantalla de origen al abrir: si la navegación cambia mientras
  // escribe, el contexto tiene que seguir siendo desde dónde la abrió.
  const [pantalla] = useState(pathname);

  const cerrar = useCallback(() => {
    if (!enviando) onClose();
  }, [enviando, onClose]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [cerrar]);

  async function enviar() {
    if (enviando) return; // el doble toque no llega ni a salir
    setError(null);
    if (!body.trim()) return setError("Contá qué querías: la descripción no puede quedar vacía.");
    if (!title.trim()) return setError("Poné un título corto.");

    setEnviando(true);
    const r = await createSuggestion({
      kind,
      title,
      body,
      contextNote,
      screen: pantalla,
      clientKey: llave(),
    });
    setEnviando(false);
    if (!r.ok) return setError(r.error ?? "No se pudo enviar.");
    setListo(true);
  }

  if (listo) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Gracias</h2>
          <div className="msub">
            Tu sugerencia le llegó a la administradora. Podés seguirla desde <b>Sugerencias</b>, y ahí vas
            a ver su respuesta cuando la conteste.
          </div>
          <div className="modal-actions">
            <button className="btn primary" onClick={onClose} autoFocus>
              Listo
            </button>
          </div>
        </div>
      </div>
    );
  }

  const desde = screenLabel(pantalla);

  return (
    <div className="overlay" onClick={cerrar}>
      <div className="modal modal-sheet sug-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Enviar sugerencia</h2>
          <div className="modal-sub">
            Contá qué te falta o qué no anda. Lo lee la administradora — nada se cambia solo.
          </div>
        </div>

        <div className="sheet-body">
          <div className="field">
            <label htmlFor="sug-tipo">Tipo</label>
            <select id="sug-tipo" value={kind} onChange={(e) => setKind(e.target.value)}>
              {SUGGESTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="sug-titulo">Título</label>
            <input
              id="sug-titulo"
              type="text"
              value={title}
              maxLength={LIMITS.title}
              autoFocus
              placeholder="Ej: falta poner cantidad por bandeja"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="sug-desc">
              Descripción <span className="req">obligatoria</span>
            </label>
            <textarea
              id="sug-desc"
              value={body}
              rows={5}
              maxLength={LIMITS.body}
              placeholder="Contá con tus palabras qué pasó o qué te gustaría que hiciera la app."
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="sug-ctx">
              Sobre qué pedido, evento o producto <span className="opt">opcional</span>
            </label>
            <input
              id="sug-ctx"
              type="text"
              value={contextNote}
              maxLength={LIMITS.context}
              placeholder="Ej: el pedido de El Carmen Center, las copas de agua"
              onChange={(e) => setContextNote(e.target.value)}
            />
          </div>

          <p className="sug-nota">
            Se envía junto con la pantalla desde la que escribís (<b>{desde}</b>), la fecha, tu nombre y la
            versión de la app. Nada de tu contraseña.
          </p>

          {error && <div className="login-error">{error}</div>}
        </div>

        <div className="sheet-foot">
          <button className="btn ghost" onClick={cerrar} disabled={enviando}>
            Cancelar
          </button>
          <button className="btn primary" onClick={enviar} disabled={enviando}>
            {enviando ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Ícono MessageSquarePlus: un globo de diálogo con un más adentro. */
export const IconSuggest = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
    <path d="M12 8v6M9 11h6" />
  </svg>
);

/** El disparador. Lo usan el menú lateral y la barra de abajo. */
export function abrirSugerencia() {
  window.dispatchEvent(new Event("abrir-sugerencia"));
}
