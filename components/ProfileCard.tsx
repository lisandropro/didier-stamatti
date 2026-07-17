"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateName } from "@/app/actions/account";

export function ProfileCard({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const changed = value.trim() !== name && value.trim().length > 0;

  async function save() {
    setSaving(true);
    setError(null);
    setDone(false);
    const res = await updateName(value);
    setSaving(false);
    if (res.ok) {
      setDone(true);
      router.refresh();
    } else {
      setError(res.error ?? "No se pudo guardar.");
    }
  }

  return (
    <div className="settings-card">
      <h2>Perfil</h2>
      <p className="settings-sub">Tu nombre es el que aparece abajo en el menú.</p>

      <div className="field">
        <label>Nombre</label>
        <input
          type="text"
          value={value}
          maxLength={40}
          onChange={(e) => {
            setValue(e.target.value);
            setDone(false);
          }}
        />
      </div>

      <div className="field">
        <label>Email (tu usuario para ingresar)</label>
        <input type="text" value={email} disabled />
      </div>

      {error && <div className="login-error">{error}</div>}
      {done && <div className="settings-ok">✓ Nombre actualizado.</div>}

      <div className="modal-actions" style={{ marginTop: 16 }}>
        <button className="btn primary" onClick={save} disabled={!changed || saving}>
          {saving ? "Guardando…" : "Guardar nombre"}
        </button>
      </div>
    </div>
  );
}
