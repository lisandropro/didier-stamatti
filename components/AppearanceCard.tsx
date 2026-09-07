"use client";

import { useSyncExternalStore } from "react";

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

function stored(key: string) { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } }
function subscribeAppearance(listener: () => void) {
  const sync = () => {
    const t = stored("didier-theme");
    const size = stored("didier-text");
    applyTheme(t === "light" || t === "dark" ? t : "auto");
    applyText(size === "grande" || size === "xl" ? size : "normal");
    listener();
  };
  window.addEventListener("storage", sync);
  window.addEventListener("didier-appearance", sync);
  return () => { window.removeEventListener("storage", sync); window.removeEventListener("didier-appearance", sync); };
}

export function AppearanceCard() {
  const themeValue = useSyncExternalStore(subscribeAppearance, () => stored("didier-theme"), () => null);
  const sizeValue = useSyncExternalStore(subscribeAppearance, () => stored("didier-text"), () => null);
  const ready = themeValue !== null;
  const theme: Theme = themeValue === "light" || themeValue === "dark" ? themeValue : "auto";
  const size: TextSize = sizeValue === "grande" || sizeValue === "xl" ? sizeValue : "normal";

  function pickTheme(t: Theme) {
    applyTheme(t);
    try {
      localStorage.setItem("didier-theme", t);
      window.dispatchEvent(new Event("didier-appearance"));
    } catch {}
  }
  function pickSize(s: TextSize) {
    applyText(s);
    try {
      localStorage.setItem("didier-text", s);
      window.dispatchEvent(new Event("didier-appearance"));
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
