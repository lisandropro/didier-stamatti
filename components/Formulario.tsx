"use client";

import { cloneElement, useId, type CSSProperties, type ReactElement, type ReactNode } from "react";

/**
 * Un campo con su rótulo, atados de verdad.
 *
 * La mayoría de los formularios tenía el `<label>` al lado del campo pero sin
 * unirlos: tocar el rótulo no enfocaba nada y el lector de pantalla anunciaba
 * "campo de texto" sin decir de qué. Acá el id sale de `useId`, así no hay que
 * inventar uno por campo ni se repiten si hay dos ventanas.
 *
 * Con un solo hijo (un `<input>`, `<select>` o `<textarea>`) el id se le pone
 * solo. Si el campo está envuelto en otra cosa, o lleva algo más al lado, se
 * pasa una función que recibe el id.
 */
export function Campo({
  label,
  children,
  className,
  style,
}: {
  label: ReactNode;
  children: ReactElement<{ id?: string }> | ((id: string) => ReactNode);
  className?: string;
  style?: CSSProperties;
}) {
  const id = useId();
  return (
    <div className={`field${className ? ` ${className}` : ""}`} style={style}>
      <label htmlFor={id}>{label}</label>
      {typeof children === "function" ? children(id) : cloneElement(children, { id })}
    </div>
  );
}

/**
 * El único cartel de error de los formularios.
 *
 * Había tres estilos distintos para lo mismo, y solo algunos se anunciaban.
 * `role="alert"` hace que el lector de pantalla lo diga en cuanto aparece.
 */
export function MensajeDeError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="alert" className={`form-error${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}

/**
 * El cartel de "salió bien".
 *
 * El contenedor se dibuja SIEMPRE, vacío mientras no hay nada que decir: los
 * lectores de pantalla anuncian los cambios de una zona que ya estaba, y una
 * que aparece ya con el texto puesto muchos no la leen (lo mismo que hace
 * `SinConexion`). Se usa `<MensajeDeExito>{listo && "✓ Guardado."}</MensajeDeExito>`.
 */
export function MensajeDeExito({ children }: { children?: ReactNode }) {
  return (
    <div role="status" aria-live="polite">
      {children ? <div className="settings-ok">{children}</div> : null}
    </div>
  );
}
