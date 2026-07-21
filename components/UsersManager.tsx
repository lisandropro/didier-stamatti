"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createUser, resetUserPassword, setUserRole, deleteUser } from "@/app/actions/users";

type User = { id: string; name: string; email: string; role: string };

const ROLE_LABEL: Record<string, string> = { ADMIN: "Administradora", ARMADOR: "Armador/a" };

const IconPlus = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
);
const IconKey = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="8" cy="15" r="4" /><path d="m10.85 12.15 8.15-8.15M18 6l2 2M15 9l1.5 1.5" /></svg>
);
const IconTrash = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 13h9l1-13" /></svg>
);

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
          const otherRole = u.role === "ADMIN" ? "ARMADOR" : "ADMIN";
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
                    <button className="btn ghost" onClick={() => setRoleChange({ user: u, to: otherRole })}>
                      Hacer {otherRole === "ADMIN" ? "administradora" : "armador/a"}
                    </button>
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
        <ConfirmModal
          title="¿Borrar este usuario?"
          body={<>Se va a borrar el acceso de <b>{deleteFor.name}</b> ({deleteFor.email}). No va a poder entrar más. Esta acción no se puede deshacer.</>}
          confirmLabel="Sí, borrar"
          danger
          run={() => deleteUser(deleteFor.id)}
          onClose={() => setDeleteFor(null)}
          onDone={() => { setDeleteFor(null); router.refresh(); }}
        />
      )}
      {roleChange && (
        <ConfirmModal
          title="¿Cambiar el rol?"
          body={
            roleChange.to === "ADMIN"
              ? <><b>{roleChange.user.name}</b> va a pasar a <b>administradora</b>: va a poder editar stock, gestionar usuarios y borrar fines de semana.</>
              : <><b>{roleChange.user.name}</b> va a pasar a <b>armador/a</b>: va a poder armar pedidos, pero no editar stock ni gestionar usuarios.</>
          }
          confirmLabel="Cambiar rol"
          run={() => setUserRole(roleChange.user.id, roleChange.to)}
          onClose={() => setRoleChange(null)}
          onDone={() => { setRoleChange(null); router.refresh(); }}
        />
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

  async function save() {
    setSaving(true);
    setError(null);
    const res = await createUser({ name, email, role, password });
    setSaving(false);
    if (res.ok) onDone();
    else setError(res.error ?? "No se pudo crear.");
  }

  const valid = name.trim() && email.includes("@") && password.length >= 6;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Nuevo usuario</h2>
        <div className="msub">Creá el acceso y pasale la contraseña temporal a la persona. Después ella la cambia desde “Mi cuenta”.</div>
        <div className="field">
          <label>Nombre</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Ej: Enrique" />
        </div>
        <div className="field">
          <label>Email (con el que va a ingresar)</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@ejemplo.com" />
        </div>
        <div className="field">
          <label>Rol</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="ARMADOR">Armador/a (arma pedidos)</option>
            <option value="ADMIN">Administradora (control total)</option>
          </select>
        </div>
        <div className="field">
          <label>Contraseña temporal</label>
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
        </div>
        {error && <div className="login-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={save} disabled={saving || !valid}>{saving ? "Creando…" : "Crear usuario"}</button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: User; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await resetUserPassword(user.id, password);
    setSaving(false);
    if (res.ok) setDone(true);
    else setError(res.error ?? "No se pudo cambiar.");
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Restablecer contraseña</h2>
        <div className="msub">Nueva contraseña temporal para <b>{user.name}</b>. Pasásela y que la cambie desde “Mi cuenta”.</div>
        {done ? (
          <>
            <div className="settings-ok">✓ Contraseña actualizada. Pasale esta contraseña a {user.name}:</div>
            <div className="reset-shown">{password}</div>
            <div className="modal-actions">
              <button className="btn primary" onClick={onDone}>Listo</button>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label>Contraseña temporal</label>
              <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus placeholder="Mínimo 6 caracteres" />
            </div>
            {error && <div className="login-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
              <button className="btn primary" onClick={save} disabled={saving || password.length < 6}>{saving ? "Guardando…" : "Cambiar contraseña"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger,
  run,
  onClose,
  onDone,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  run: () => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setSaving(true);
    setError(null);
    const res = await run();
    setSaving(false);
    if (res.ok) onDone();
    else setError(res.error ?? "No se pudo completar.");
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="msub">{body}</div>
        {error && <div className="login-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className={`btn ${danger ? "danger" : "primary"}`} onClick={confirm} disabled={saving}>
            {saving ? "Aplicando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
