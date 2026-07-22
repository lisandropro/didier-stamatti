"use client";

import { useState } from "react";

const IconShare = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" /><path d="M12 3v13M8 7l4-4 4 4" />
  </svg>
);

const cleanName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();

export function ShareOrderButton({
  eventId,
  lugar,
  dateLabel,
  disabled,
}: {
  eventId: string;
  lugar: string;
  dateLabel: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function share() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/evento/${eventId}/pdf-file`);
      if (!res.ok) throw new Error("No se pudo generar el PDF.");
      const blob = await res.blob();
      const filename = `${cleanName(`Pedido - ${lugar} - ${dateLabel}`)}.pdf`;
      const file = new File([blob], filename, { type: "application/pdf" });

      // Compartir nativo del celular (WhatsApp, mail, etc.) si el dispositivo lo permite.
      const nav = navigator as Navigator & {
        canShare?: (d: ShareData) => boolean;
        share?: (d: ShareData) => Promise<void>;
      };
      if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: filename, text: `Pedido — ${lugar} (${dateLabel})` });
          return;
        } catch (e) {
          if (e instanceof Error && e.name === "AbortError") return; // el usuario cerró el menú: no es error
          // si el share nativo falla por otro motivo, cae al descargar
        }
      }

      // En computadora (o si no hay menú de compartir): descarga el archivo.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg("PDF descargado — ya lo podés enviar.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo compartir.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="share-wrap">
      <button className="btn primary" onClick={share} disabled={busy || disabled}>
        {IconShare} {busy ? "Preparando…" : "Compartir"}
      </button>
      {msg && <span className="share-msg">{msg}</span>}
    </div>
  );
}
