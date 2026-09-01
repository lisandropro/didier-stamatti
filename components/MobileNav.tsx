"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotifBadge } from "@/components/NotifBadge";
import { NavPending } from "@/components/NavPending";
import { canSendSuggestions, canEditOrders, canCapturarComprobantes } from "@/lib/permissions";
import { IconSuggest, abrirSugerencia } from "@/components/SuggestionBox";

const RECEPCION = {
  href: "/recepcion",
  label: "Recepción",
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.4" />
    </svg>
  ),
};

/** Los tres primeros son de quien arma pedidos. Quien solo recibe mercadería
 *  no los usa, y la barra tiene seis lugares: llenarla con lo que uno no toca
 *  es hacerle buscar el suyo entre cosas ajenas. */
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

  // Pagos NO está acá: quien paga trabaja sentada en una oficina, y esa
  // pantalla es una tabla. Vive en el menú lateral.
  const items = [
    ...(canEditOrders(role) ? ITEMS.slice(0, 3) : []),
    ...(canCapturarComprobantes(role) ? [RECEPCION] : []),
    ...ITEMS.slice(3),
  ];

  return (
    <nav className={`mobnav${items.length + (puedeSugerir ? 1 : 0) > 5 ? " mobnav-6" : ""}`}>
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={active ? "active" : ""}>
            <span className="mobnav-ico">{item.icon}{item.href === "/notificaciones" && <NotifBadge />}</span>
            {item.label}
            <NavPending />
          </Link>
        );
      })}
      {puedeSugerir && (
        <button type="button" onClick={abrirSugerencia} aria-label="Enviar sugerencia">
          <span className="mobnav-ico">{IconSuggest}</span>
          Sugerir
        </button>
      )}
    </nav>
  );
}
