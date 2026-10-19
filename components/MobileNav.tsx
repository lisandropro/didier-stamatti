"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NotifBadge } from "@/components/NotifBadge";
import { NavPending } from "@/components/NavPending";
import { canSendSuggestions, canVerStock } from "@/lib/permissions";
import { IconSuggest, abrirSugerencia } from "@/components/SuggestionBox";

/** Los tres primeros son las pantallas del stock: solo con un rol que las vea. */
const ITEMS = [
  {
    href: "/",
    label: "Período",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" />
      </svg>
    ),
  },
  {
    href: "/inventario",
    label: "Inventario",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3.5 7 12 3l8.5 4v10L12 21l-8.5-4z" /><path d="M3.5 7 12 11l8.5-4M12 11v10" />
      </svg>
    ),
  },
  {
    href: "/historial",
    label: "Historial",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 8v4l3 2" />
      </svg>
    ),
  },
  {
    href: "/notificaciones",
    label: "Avisos",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 20a2 2 0 0 0 4 0" />
      </svg>
    ),
  },
  {
    href: "/cuenta",
    label: "Cuenta",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" />
      </svg>
    ),
  },
];

export function MobileNav({ role }: { role: string }) {
  const pathname = usePathname();
  // Se suma un lugar más, no un botón flotante: un flotante se pone encima de
  // lo que haya debajo y en un pedido largo tapa justamente lo que se mira.
  const puedeSugerir = canSendSuggestions(role);
  const [abierta, setAbierta] = useState(false);
  const SUGERIR = { href: "", label: "Sugerir", icon: IconSuggest, accion: abrirSugerencia };

  const items = [...(canVerStock(role) ? ITEMS.slice(0, 3) : []), ...ITEMS.slice(3)];

  // La barra tiene lugar para seis. No es un numero elegido: abajo de 860px la
  // pantalla mas angosta que se usa son 360px, y a seis entradas cada una queda
  // en 60px — el ancho minimo para que la etiqueta se lea entera.
  //
  // Hoy la cuenta da seis justas (cinco secciones y Sugerir). Si mañana se
  // suma una séptima, el sobrante va a una hoja, no se esconde.
  const CUPO = 6;
  const todos = [...items, ...(puedeSugerir ? [SUGERIR] : [])];
  const hayDesborde = todos.length > CUPO;
  const visibles = hayDesborde ? todos.slice(0, CUPO - 1) : todos;
  const sobrantes = hayDesborde ? todos.slice(CUPO - 1) : [];

  return (
    <>
      {abierta && (
        <div className="mobmas-fondo" onClick={() => setAbierta(false)}>
          <div className="mobmas" onClick={(e) => e.stopPropagation()}>
            {sobrantes.map((item) => renderEntrada(item, pathname, () => setAbierta(false), true))}
          </div>
        </div>
      )}
      <nav className={`mobnav${todos.length > 5 ? " mobnav-6" : ""}`}>
        {visibles.map((item) => renderEntrada(item, pathname, undefined, false))}
        {hayDesborde && (
          <button
            type="button"
            onClick={() => setAbierta((v) => !v)}
            aria-expanded={abierta}
            aria-label="Más secciones"
            className={sobrantes.some((i) => esActiva(pathname, i.href)) ? "active" : ""}
          >
            <span className="mobnav-ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" />
              </svg>
            </span>
            Más
          </button>
        )}
      </nav>
    </>
  );
}

type Entrada = { href: string; label: string; icon: React.ReactNode; accion?: () => void };

function esActiva(pathname: string, href: string) {
  if (!href) return false;
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function renderEntrada(item: Entrada, pathname: string, alTocar: (() => void) | undefined, enHoja: boolean) {
  if (item.accion) {
    return (
      <button
        key={item.label}
        type="button"
        onClick={() => { alTocar?.(); item.accion!(); }}
        aria-label={item.label}
      >
        <span className="mobnav-ico">{item.icon}</span>
        {item.label}
      </button>
    );
  }
  return (
    <Link
      key={item.href}
      href={item.href}
      onClick={alTocar}
      className={esActiva(pathname, item.href) ? "active" : ""}
    >
      <span className="mobnav-ico">
        {item.icon}
        {item.href === "/notificaciones" && <NotifBadge />}
      </span>
      {item.label}
      {!enHoja && <NavPending />}
    </Link>
  );
}
