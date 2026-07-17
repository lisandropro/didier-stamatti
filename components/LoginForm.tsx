"use client";

import { useActionState, useState } from "react";
import { login, type LoginState } from "@/app/actions/auth";

const initial: LoginState = {};

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

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initial);
  const [showPass, setShowPass] = useState(false);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <span className="logo-mark" role="img" aria-label="Didier Stamatti Catering" />
        </div>
        <h1>INGRESAR</h1>
        <p className="login-sub">Control de stock y pedidos</p>

        <form action={action}>
          <div className="field">
            <label>Email</label>
            <input name="email" type="email" autoComplete="username" required autoFocus />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <div className="pass-wrap">
              <input
                name="password"
                type={showPass ? "text" : "password"}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="pass-toggle"
                onClick={() => setShowPass((s) => !s)}
                aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
                title={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {showPass ? EyeOffIcon : EyeIcon}
              </button>
            </div>
          </div>

          <label className="remember">
            <input type="checkbox" name="remember" /> Recordarme en este dispositivo
          </label>

          {state?.error && <div className="login-error">{state.error}</div>}

          <button
            className="btn primary"
            type="submit"
            disabled={pending}
            style={{ width: "100%", justifyContent: "center", marginTop: 12 }}
          >
            {pending ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}
