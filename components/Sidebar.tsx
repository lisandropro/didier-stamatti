"use client";

import Link from "next/link";
import {
  ROLE_LABEL,
  canSendSuggestions,
  canManageSuggestions,
  canEditOrders,
  canCapturarComprobantes,
  canVerImportes,
} from "@/lib/permissions";
import { IconSuggest, abrirSugerencia } from "@/components/SuggestionBox";
import { NavPending } from "@/components/NavPending";
import { usePathname } from "next/navigation";
import { logout } from "@/app/actions/auth";
import { NotifBadge } from "@/components/NotifBadge";

const ICONS = {
  finde: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /><path d="M9.5 20v-5h5v5" />
    </svg>
  ),
  pedido: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="3.5" width="16" height="17" rx="2.5" /><path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  ),
  inventario: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3.5 7 12 3l8.5 4v10L12 21l-8.5-4z" /><path d="M3.5 7 12 11l8.5-4M12 11v10" />
    </svg>
  ),
  historial: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 8v4l3 2" />
    </svg>
  ),
  usuarios: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 20a6.5 6.5 0 0 0-3-5.5" />
    </svg>
  ),
  avisos: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  ),
};

const ICONO_RECEPCION = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.4" />
  </svg>
);
const ICONO_PAGOS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 6h16v12H4z" /><path d="M4 10h16" /><path d="M8 14.5h4" />
  </svg>
);

/** El pedido y el inventario: solo para quien los arma. Alguien que entra a
 *  fotografiar comprobantes o a pagarlos no tiene por qué ver esas pantallas —
 *  una nav con lo que uno no usa es una nav que se lee más lento. */
const NAV_STOCK = [
  { href: "/", label: "Período", icon: ICONS.finde },
  { href: "/inventario", label: "Inventario", icon: ICONS.inventario },
  { href: "/historial", label: "Historial", icon: ICONS.historial },
];
const NAV_AVISOS = [{ href: "/notificaciones", label: "Avisos", icon: ICONS.avisos }];
/** La bandeja de sugerencias es de quien las gestiona. Los demás tienen el
 *  botón de mandarlas y nada más: para ellos es un buzón, no una sección. */
const ADMIN_NAV = [
  { href: "/sugerencias", label: "Sugerencias", icon: IconSuggest },
  { href: "/usuarios", label: "Usuarios", icon: ICONS.usuarios },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}



export function Sidebar({ user }: { user: { name: string; role: string } }) {
  const pathname = usePathname();
  const initial = (user.name?.[0] ?? "?").toUpperCase();
  const puedeSugerir = canSendSuggestions(user.role);
  const nav = [
    ...(canEditOrders(user.role) ? NAV_STOCK : []),
    ...(canCapturarComprobantes(user.role)
      ? [{ href: "/recepcion", label: "Recepción", icon: ICONO_RECEPCION }]
      : []),
    ...(canVerImportes(user.role) ? [{ href: "/pagos", label: "Pagos", icon: ICONO_PAGOS }] : []),
    ...NAV_AVISOS,
    ...(canManageSuggestions(user.role) ? ADMIN_NAV : []),
  ];

  return (
    <aside className="side">
      <div className="brand">
        <span className="logo-mark" role="img" aria-label="Didier Stamatti Catering" />
      </div>
      <div className="nav-label">Menú</div>
      {nav.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`nav${isActive(pathname, item.href) ? " active" : ""}`}
        >
          {item.icon}
          {item.label}
          {item.href === "/notificaciones" && <NotifBadge />}
          <NavPending />
        </Link>
      ))}
      {puedeSugerir && (
        <button type="button" className="nav nav-action" onClick={abrirSugerencia}>
          {IconSuggest}
          Enviar sugerencia
        </button>
      )}
      <div className="foot">
        <Link href="/cuenta" className="foot-user" title="Mi cuenta">
          <NavPending />
          <div className="avatar">{initial}</div>
          <div className="foot-id">
            <div className="foot-name">{user.name}</div>
            <div className="foot-role">{ROLE_LABEL[user.role] ?? user.role}</div>
          </div>
        </Link>
        <form action={logout}>
          <button type="submit" className="logout-btn" title="Cerrar sesión" aria-label="Cerrar sesión">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M15 12H4M8 8l-4 4 4 4" /><path d="M11 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
            </svg>
          </button>
        </form>
      </div>
    </aside>
  );
}
