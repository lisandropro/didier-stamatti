"use client";

import { useActionState, useState } from "react";
import { login, type LoginState } from "@/app/actions/auth";
import { MensajeDeError } from "@/components/Formulario";
import { IconEye, IconEyeOff } from "@/components/iconos";

const initial: LoginState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initial);
  const [showPass, setShowPass] = useState(false);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <span className="logo-mark" role="img" aria-label="Didier Stamatti Catering" />
        </div>
        {/* Las mayúsculas las pone el estilo: escrito "INGRESAR", un lector de
            pantalla puede deletrearlo. */}
        <h1 className="login-titulo">Ingresar</h1>
        <p className="login-sub">Control de stock y pedidos</p>

        <form action={action}>
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input id="login-email" name="email" type="email" autoComplete="username" maxLength={254} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="login-password">Contraseña</label>
            <div className="pass-wrap">
              <input
                name="password"
                id="login-password"
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
                {showPass ? IconEyeOff : IconEye}
              </button>
            </div>
          </div>

          <label className="remember">
            {/* Marcado de entrada: la app se usa instalada en el teléfono de cada
                uno, y sin esto la sesión dura 8 horas y al otro día pide la
                contraseña de nuevo. En un teléfono prestado se destilda. */}
            <input type="checkbox" name="remember" defaultChecked /> Recordarme en este teléfono o computadora
          </label>

          {state?.error && <MensajeDeError>{state.error}</MensajeDeError>}

          <button
            className="btn primary"
            type="submit"
            disabled={pending}
            style={{ width: "100%", justifyContent: "center", marginTop: 12 }}
          >
            {pending ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
        <p className="login-ayuda">¿No te acordás la contraseña? Pedile una nueva a la administradora.</p>
      </div>
    </div>
  );
}
