"use client";

import { useLinkStatus } from "next/link";

/** Señal inmediata de que el toque se registró, mientras la pantalla nueva
 *  viaja al servidor. Debe usarse dentro de un <Link>. */
export function NavPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`nav-pending${pending ? " is-pending" : ""}`} />;
}
