"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markAllRead } from "@/app/actions/notifications";

type Item = { id: string; message: string; eventId: string | null; read: boolean; at: string };

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

const IconBell = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);

export function NotificationsList({ items }: { items: Item[] }) {
  const router = useRouter();

  // Al abrir la pantalla, se marcan como leídos y se avisa a la campana.
  useEffect(() => {
    if (items.some((i) => !i.read)) {
      markAllRead().then(() => window.dispatchEvent(new Event("notif-read")));
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
          className={`notif-item${n.read ? "" : " unread"}`}
          onClick={() => n.eventId && router.push(`/evento/${n.eventId}`)}
          disabled={!n.eventId}
        >
          <span className="notif-icon">{IconBell}</span>
          <span className="notif-body">
            <span className="notif-msg">{n.message}</span>
            <span className="notif-time">{relative(n.at)}</span>
          </span>
          {!n.read && <span className="notif-dot" aria-label="Sin leer" />}
        </button>
      ))}
    </div>
  );
}
