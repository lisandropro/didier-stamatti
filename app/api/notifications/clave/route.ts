import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * La clave pública de avisos, para que el service worker pueda renovar la
 * suscripción solo cuando el navegador la cambia (`pushsubscriptionchange`).
 * Es pública por definición: no lleva sesión.
 */
export async function GET() {
  return NextResponse.json({ clave: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "" });
}
