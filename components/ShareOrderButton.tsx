"use client";

import { useState } from "react";
import { nombreDeArchivo } from "@/lib/order-sections";
import { IconShare } from "@/components/iconos";


export function ShareOrderButton({
  eventId,
  lugar,
  dateLabel,
  disabled,
  sector,
  label = "Compartir",
  variant = "primary",
}: {
  eventId: string;
  lugar: string;
  dateLabel: string;
  disabled?: boolean;
  /** Sin sector se comparte el pedido entero. Con sector, solo esa hoja:
   *  a quien prepara la bebida no le sirven las de mobiliario. */
  sector?: string;
  label?: string;
  variant?: "primary" | "ghost";
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function share() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/evento/${eventId}/pdf-file${sector ? `?sector=${sector}` : ""}`);
      if (!res.ok) throw new Error("No se pudo generar el PDF.");
      const blob = await res.blob();
      const filename = `${nombreDeArchivo(lugar, dateLabel, sector)}.pdf`;
      const file = new File([blob], filename, { type: "application/pdf" });

      // Compartir nativo del celular (WhatsApp, mail, etc.) si el dispositivo lo permite.
      const nav = navigator as Navigator & {
        canShare?: (d: ShareData) => boolean;
        share?: (d: ShareData) => Promise<void>;
      };
      if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: filename, text: `${sector ? `${label} — ` : ""}Pedido — ${lugar} (${dateLabel})` });
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
      <button type="button" className={`btn ${variant}`} onClick={share} disabled={busy || disabled}>
        {IconShare} {busy ? "Preparando…" : label}
      </button>
      {/* Siempre dibujado, vacío mientras no hay nada que decir: así el lector de
          pantalla anuncia "PDF descargado" cuando aparece. */}
      <span className="share-msg" role="status" aria-live="polite">{msg}</span>
    </div>
  );
}
