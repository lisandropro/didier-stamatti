"use client";

import { useEffect, useState } from "react";

type Theme = "auto" | "light" | "dark";
type TextSize = "normal" | "grande" | "xl";

const THEMES: { v: Theme; l: string; hint: string }[] = [
  { v: "auto", l: "Automático", hint: "Sigue la configuración del dispositivo" },
  { v: "light", l: "Claro", hint: "Siempre claro" },
  { v: "dark", l: "Oscuro", hint: "Siempre oscuro" },
];
const SIZES: { v: TextSize; l: string }[] = [
  { v: "normal", l: "Normal" },
  { v: "grande", l: "Grande" },
  { v: "xl", l: "Más grande" },
];

function applyTheme(t: Theme) {
  const el = document.documentElement;
  if (t === "auto") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", t);
}
function applyText(s: TextSize) {
  const el = document.documentElement;
  if (s === "normal") el.removeAttribute("data-text");
  else el.setAttribute("data-text", s);
}

export function AppearanceCard() {
  const [theme, setTheme] = useState<Theme>("auto");
  const [size, setSize] = useState<TextSize>("normal");
  const [ready, setReady] = useState(false);

  // Se leen después de montar para no chocar con el HTML del servidor.
  useEffect(() => {
    try {
      const t = localStorage.getItem("didier-theme") as Theme | null;
      if (t === "light" || t === "dark") setTheme(t);
      const s = localStorage.getItem("didier-text") as TextSize | null;
      if (s === "grande" || s === "xl") setSize(s);
    } catch {}
    setReady(true);
  }, []);

  function pickTheme(t: Theme) {
    setTheme(t);
    applyTheme(t);
    try {
      localStorage.setItem("didier-theme", t);
    } catch {}
  }
  function pickSize(s: TextSize) {
    setSize(s);
    applyText(s);
    try {
      localStorage.setItem("didier-text", s);
    } catch {}
  }

  return (
    <div className="settings-card">
      <h2>Apariencia y accesibilidad</h2>
      <p className="settings-sub">
        Estos ajustes se guardan en este dispositivo. Podés tener letra grande en el celular y normal en la
        computadora.
      </p>

      <div className="field">
        <label>Tamaño de texto</label>
        <div className="seg">
          {SIZES.map((s) => (
            <button
              key={s.v}
              className={ready && size === s.v ? "active" : ""}
              onClick={() => pickSize(s.v)}
              aria-pressed={ready && size === s.v}
            >
              {s.l}
            </button>
          ))}
        </div>
        <p className="settings-hint">Se aplica al instante en toda la app. Lo que imprimís no cambia.</p>
      </div>

      <div className="field" style={{ marginTop: 20, marginBottom: 4 }}>
        <label>Tema</label>
        <div className="seg">
          {THEMES.map((t) => (
            <button
              key={t.v}
              className={ready && theme === t.v ? "active" : ""}
              onClick={() => pickTheme(t.v)}
              aria-pressed={ready && theme === t.v}
            >
              {t.l}
            </button>
          ))}
        </div>
        <p className="settings-hint">{THEMES.find((t) => t.v === theme)?.hint}</p>
      </div>
    </div>
  );
}
