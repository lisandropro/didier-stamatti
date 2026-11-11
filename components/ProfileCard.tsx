"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateName } from "@/app/actions/account";
import { intentar } from "@/lib/actualizacion";
import { Campo, MensajeDeError, MensajeDeExito } from "@/components/Formulario";

export function ProfileCard({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const changed = value.trim() !== name && value.trim().length > 0;

  async function save() {
    if (!changed || saving) return;
    setSaving(true);
    setError(null);
    setDone(false);
    const res = await intentar(() => updateName(value));
    setSaving(false);
    if (res.ok) {
      setDone(true);
      router.refresh();
    } else {
      setError(res.error ?? "No se pudo guardar.");
    }
  }

  return (
    <form
      className="settings-card"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2>Perfil</h2>
      <p className="settings-sub">Tu nombre es el que aparece abajo en el menú.</p>

      <Campo label="Nombre">
        <input
          type="text"
          value={value}
          maxLength={40}
          autoComplete="name"
          onChange={(e) => {
            setValue(e.target.value);
            setDone(false);
          }}
        />
      </Campo>

      <Campo label="Email (tu usuario para ingresar)">
        <input type="text" value={email} disabled />
      </Campo>

      {error && <MensajeDeError>{error}</MensajeDeError>}
      <MensajeDeExito>{done && "✓ Nombre actualizado."}</MensajeDeExito>

      <div className="modal-actions" style={{ marginTop: 16 }}>
        <button type="submit" className="btn primary" disabled={!changed || saving}>
          {saving ? "Guardando…" : "Guardar nombre"}
        </button>
      </div>
    </form>
  );
}
