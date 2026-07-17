"use client";

import { useState } from "react";
import { changePassword } from "@/app/actions/account";

const EyeIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeOffIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M3 3l18 18" /><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
    <path d="M9.4 5.2A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.3 3.2M6.2 6.2A17 17 0 0 0 2 12s3.5 7 10 7a9.4 9.4 0 0 0 3.4-.6" />
  </svg>
);

function PwField({
  label,
  value,
  onChange,
  autoComplete,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label>{label}</label>
      <div className="pass-wrap">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          className="pass-toggle"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
          title={show ? "Ocultar contraseña" : "Mostrar contraseña"}
        >
          {show ? EyeOffIcon : EyeIcon}
        </button>
      </div>
    </div>
  );
}

export function AccountForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setDone(false);
    const res = await changePassword({ current, next, confirm });
    setSaving(false);
    if (res.ok) {
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } else {
      setError(res.error ?? "No se pudo cambiar la contraseña.");
    }
  }

  const canSave = current.length > 0 && next.length > 0 && confirm.length > 0 && !saving;

  return (
    <div className="settings-card">
      <h2>Seguridad</h2>
      <p className="settings-sub">Para cambiar tu contraseña, primero escribí la que usás ahora.</p>

      <PwField label="Contraseña actual" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
      <PwField label="Contraseña nueva" value={next} onChange={setNext} autoComplete="new-password" />
      <PwField label="Repetir contraseña nueva" value={confirm} onChange={setConfirm} autoComplete="new-password" />

      <p className="settings-hint">Mínimo 6 caracteres.</p>

      {error && <div className="login-error">{error}</div>}
      {done && <div className="settings-ok">✓ Contraseña actualizada. Usá la nueva la próxima vez que ingreses.</div>}

      <div className="modal-actions" style={{ marginTop: 18 }}>
        <button className="btn primary" onClick={save} disabled={!canSave}>
          {saving ? "Guardando…" : "Cambiar contraseña"}
        </button>
      </div>
    </div>
  );
}
