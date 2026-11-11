"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markAllRead } from "@/app/actions/notifications";
import { IconBell } from "@/components/iconos";

type Item = { id: string; message: string; eventId: string | null; read: boolean; at: string; changeCount: number; linkUrl: string | null };

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ayer";
  if (d < 7) return `hace ${d} días`;
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

export function NotificationsList({ items }: { items: Item[] }) {
  const router = useRouter();

  // Al abrir la pantalla, se marcan como leídos y se avisa a la campana.
  useEffect(() => {
    if (items.some((i) => !i.read)) {
      // Si falla (sin señal), no pasa nada: quedan sin leer y se marcan la próxima vez.
      markAllRead().then(() => window.dispatchEvent(new Event("notif-read"))).catch(() => {});
    } else {
      window.dispatchEvent(new Event("notif-read"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items.length === 0) {
    return (
      <div className="empty-card">
        <p className="empty-title">No hay avisos todavía</p>
        <p>Acá vas a ver cuando alguien del equipo modifique un pedido.</p>
      </div>
    );
  }

  return (
    <div className="notif-list">
      {items.map((n) => (
        <button
          key={n.id}
          type="button"
          className={`notif-item${n.read ? "" : " unread"}`}
          // Los avisos de pedidos llevan al resumen de qué cambió, no directo al
          // pedido: sin el detalle hay que buscar a ojo qué se tocó. Los demás
          // (una sugerencia, por ejemplo) traen su propio destino.
          onClick={() => router.push(n.linkUrl ?? `/aviso/${n.id}`)}
        >
          <span className="notif-icon">{IconBell}</span>
          <span className="notif-body">
            <span className="notif-msg">{n.message}</span>
            <span className="notif-time">
              {relative(n.at)}
              {n.changeCount > 1 ? ` · ${n.changeCount} cambios` : ""}
            </span>
          </span>
          {/* El punto es decoración; lo que se lee es "Sin leer". */}
          {!n.read && <span className="notif-dot" aria-hidden="true" />}
          {!n.read && <span className="sr-only">Sin leer</span>}
        </button>
      ))}
    </div>
  );
}
