"use client";

import { useState } from "react";
import { changePassword } from "@/app/actions/account";
import { intentar } from "@/lib/actualizacion";
import { Campo, MensajeDeError, MensajeDeExito } from "@/components/Formulario";
import { IconEye, IconEyeOff } from "@/components/iconos";

function PwField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <Campo label={label}>
      {(id) => (
        <div className="pass-wrap">
          <input
            id={id}
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoComplete={autoComplete}
          />
          <button
            type="button"
            className="pass-toggle"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
            title={show ? "Ocultar contraseña" : "Mostrar contraseña"}
          >
            {show ? IconEyeOff : IconEye}
          </button>
        </div>
      )}
    </Campo>
  );
}

export function AccountForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canSave = current.length > 0 && next.length > 0 && confirm.length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setDone(false);
    const res = await intentar(() => changePassword({ current, next, confirm }));
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

  return (
    // Un formulario de verdad: Enter guarda, y el teléfono ofrece actualizar la
    // contraseña que tiene guardada. Sin `autoFocus`: en el celular, abrir
    // Cuenta saltaba a esta tarjeta y levantaba el teclado.
    <form
      className="settings-card"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2>Seguridad</h2>
      <p className="settings-sub">Para cambiar tu contraseña, primero escribí la que usás ahora.</p>

      <PwField label="Contraseña actual" value={current} onChange={setCurrent} autoComplete="current-password" />
      <PwField label="Contraseña nueva" value={next} onChange={setNext} autoComplete="new-password" />
      <PwField label="Repetir contraseña nueva" value={confirm} onChange={setConfirm} autoComplete="new-password" />

      <p className="settings-hint">Mínimo 8 caracteres.</p>

      {error && <MensajeDeError>{error}</MensajeDeError>}
      <MensajeDeExito>{done && "✓ Contraseña actualizada. Se cerró la sesión en tus otros teléfonos y computadoras; en este seguís adentro."}</MensajeDeExito>

      <div className="modal-actions" style={{ marginTop: 18 }}>
        <button type="submit" className="btn primary" disabled={!canSave}>
          {saving ? "Guardando…" : "Cambiar contraseña"}
        </button>
      </div>
    </form>
  );
}
