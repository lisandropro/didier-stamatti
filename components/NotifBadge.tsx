"use client";

import { useEffect, useState } from "react";

// Insignia con la cantidad de avisos sin leer.
//
// No consulta por su cuenta: el Actualizador ya hace esa llamada cada tanto
// —la usa para saber si cambió la versión— y publica el número acá. Una sola
// petición para las dos cosas.
export function NotifBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const onCount = (e: Event) => setCount((e as CustomEvent<number>).detail ?? 0);
    const onRead = () => setCount(0);
    window.addEventListener("notif-count", onCount);
    window.addEventListener("notif-read", onRead);
    return () => {
      window.removeEventListener("notif-count", onCount);
      window.removeEventListener("notif-read", onRead);
    };
  }, []);

  if (count <= 0) return null;
  return <span className="notif-badge">{count > 9 ? "9+" : count}</span>;
}
