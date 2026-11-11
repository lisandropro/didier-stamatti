"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createUser, resetUserPassword, setUserRole, deleteUser } from "@/app/actions/users";
import { ROLES, ROLE_LABEL, ROLE_HELP } from "@/lib/permissions";
import { intentar } from "@/lib/actualizacion";
import { Confirmar, Dialogo } from "@/components/Dialogo";
import { Campo, MensajeDeError, MensajeDeExito } from "@/components/Formulario";
import { IconKey, IconPlus, IconTrash } from "@/components/iconos";

type User = { id: string; name: string; email: string; role: string };

/** Qué implica cada rol, en la confirmación de cambio de rol. */
const ROLE_DETALLE: Record<string, string> = {
  ADMIN: "va a poder editar stock, administrar el catálogo, gestionar usuarios y borrar períodos.",
  ARMADOR: "va a poder armar pedidos y manejar los períodos, pero no editar stock ni el catálogo ni los usuarios.",
  LOGISTICA:
    "va a poder mirar todo —pedidos, faltantes, inventario e historiales—, cambiar el responsable de cada evento y tildar lo que se prepara en el depósito. No va a poder modificar pedidos, stock ni el catálogo.",
  DEPOSITO:
    "va a ver en el teléfono los eventos que vienen, con sus pedidos y lo que falta, y tildar lo que prepara. No va a poder modificar pedidos, ni entrar al inventario, al historial ni a los usuarios.",
};



export function UsersManager({ users, meId }: { users: User[]; meId: string }) {
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [deleteFor, setDeleteFor] = useState<User | null>(null);
  const [roleChange, setRoleChange] = useState<{ user: User; to: string } | null>(null);

  return (
    <>
      <div className="users-head">
        <p className="users-count">
          {users.length} usuario{users.length === 1 ? "" : "s"}
        </p>
        <button className="btn primary" onClick={() => setShowNew(true)}>{IconPlus} Nuevo usuario</button>
      </div>

      <div className="user-list">
        {users.map((u) => {
          const isMe = u.id === meId;
          return (
            <div key={u.id} className="user-row">
              <div className="avatar user-avatar">{(u.name[0] ?? "?").toUpperCase()}</div>
              <div className="user-info">
                <div className="user-name">
                  {u.name}
                  {isMe && <span className="chip neutral" style={{ marginLeft: 8 }}>vos</span>}
                </div>
                <div className="user-email">{u.email}</div>
              </div>
              <span className={`chip ${u.role === "ADMIN" ? "ok" : "neutral"} user-rolechip`}>
                {ROLE_LABEL[u.role] ?? u.role}
              </span>
              <div className="user-actions">
                <button className="btn ghost" onClick={() => setResetFor(u)}>{IconKey} Contraseña</button>
                {isMe ? (
                  <span className="user-self-note">Tu cuenta la gestionás desde “Mi cuenta”.</span>
                ) : (
                  <>
                    <select
                      className="user-role-select"
                      value={u.role}
                      aria-label={`Rol de ${u.name}`}
                      onChange={(e) => setRoleChange({ user: u, to: e.target.value })}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                      ))}
                    </select>
                    <button className="btn btn-del" onClick={() => setDeleteFor(u)}>{IconTrash} Borrar</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showNew && (
        <NewUserModal onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); router.refresh(); }} />
      )}
      {resetFor && (
        <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} onDone={() => { setResetFor(null); router.refresh(); }} />
      )}
      {deleteFor && (
        <Confirmar
          titulo="¿Borrar este usuario?"
          textoConfirmar="Sí, borrar"
          textoEnCurso="Borrando…"
          peligro
          accion={() => deleteUser(deleteFor.id)}
          onCerrar={() => setDeleteFor(null)}
          alListo={() => { setDeleteFor(null); router.refresh(); }}
        >
          Se va a borrar el acceso de <b>{deleteFor.name}</b> ({deleteFor.email}). No va a poder entrar más. Esta acción no se puede deshacer.
        </Confirmar>
      )}
      {roleChange && (
        <Confirmar
          titulo="¿Cambiar el rol?"
          textoConfirmar="Cambiar rol"
          accion={() => setUserRole(roleChange.user.id, roleChange.to)}
          onCerrar={() => setRoleChange(null)}
          alListo={() => { setRoleChange(null); router.refresh(); }}
        >
          <b>{roleChange.user.name}</b> va a pasar a <b>{ROLE_LABEL[roleChange.to]?.toLowerCase()}</b>:{" "}
          {ROLE_DETALLE[roleChange.to] ?? "cambia lo que puede hacer en la app."}
        </Confirmar>
      )}
    </>
  );
}

function NewUserModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("ARMADOR");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = Boolean(name.trim()) && email.includes("@") && password.length >= 6;

  async function save() {
    if (saving || !valid) return;
    setSaving(true);
    setError(null);
    const res = await intentar(() => createUser({ name, email, role, password }));
    setSaving(false);
    if (res.ok) onDone();
    else setError(res.error ?? "No se pudo crear.");
  }

  return (
    <Dialogo
      titulo="Nuevo usuario"
      onCerrar={onClose}
      ocupado={saving}
      cambiado={Boolean(name || email || password)}
      sinDeslizar
      alEnviar={save}
    >
      <div className="msub">Creá el acceso y pasale la contraseña temporal a la persona. Después ella la cambia desde “Mi cuenta”.</div>
      <Campo label="Nombre">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" placeholder="Ej: Enrique" />
      </Campo>
      <Campo label="Email (con el que va a ingresar)">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="nombre@ejemplo.com" />
      </Campo>
      <Campo label="Rol">
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]} ({ROLE_HELP[r]})
            </option>
          ))}
        </select>
      </Campo>
      <Campo label="Contraseña temporal">
        {/* A la vista y sin que el navegador ofrezca guardarla: es de otra persona. */}
        <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Mínimo 8 caracteres" />
      </Campo>
      {error && <MensajeDeError>{error}</MensajeDeError>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" className="btn primary" disabled={saving || !valid}>{saving ? "Creando…" : "Crear usuario"}</button>
      </div>
    </Dialogo>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: User; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    if (saving || password.length < 6) return;
    setSaving(true);
    setError(null);
    const res = await intentar(() => resetUserPassword(user.id, password));
    setSaving(false);
    if (res.ok) setDone(true);
    else setError(res.error ?? "No se pudo cambiar.");
  }

  return (
    <Dialogo
      titulo="Restablecer contraseña"
      // Ya cambiada, cerrar es "Listo": hay que refrescar la lista igual.
      onCerrar={done ? onDone : onClose}
      ocupado={saving}
      cambiado={!done && password.length > 0}
      sinDeslizar
      alEnviar={done ? onDone : save}
    >
      <div className="msub">Nueva contraseña temporal para <b>{user.name}</b>. Pasásela y que la cambie desde “Mi cuenta”.</div>
      <MensajeDeExito>{done && <>✓ Contraseña actualizada. Pasale esta contraseña a {user.name}:</>}</MensajeDeExito>
      {done ? (
        <>
          <div className="reset-shown">{password}</div>
          <div className="modal-actions">
            <button type="submit" className="btn primary" autoFocus>Listo</button>
          </div>
        </>
      ) : (
        <>
          <Campo label="Contraseña temporal">
            <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Mínimo 8 caracteres" />
          </Campo>
          {error && <MensajeDeError>{error}</MensajeDeError>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={saving || password.length < 6}>{saving ? "Guardando…" : "Cambiar contraseña"}</button>
          </div>
        </>
      )}
    </Dialogo>
  );
}
