"use client";

import { useEffect, useState } from "react";

// Insignia con la cantidad de avisos sin leer. Consulta cada tanto y también
// se actualiza al instante cuando se marcan como leídos (evento "notif-read").
export function NotifBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/notifications/count", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setCount(data.count ?? 0);
      } catch {}
    }
    load();
    const timer = setInterval(load, 45000);
    const onRead = () => setCount(0);
    window.addEventListener("notif-read", onRead);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("notif-read", onRead);
    };
  }, []);

  if (count <= 0) return null;
  return <span className="notif-badge">{count > 9 ? "9+" : count}</span>;
}
