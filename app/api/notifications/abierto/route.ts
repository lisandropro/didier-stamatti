import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { mismoOrigen } from "@/lib/mismo-origen";
import { registrarApertura } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El service worker avisa que la persona tocó un push.
 *
 * Sirve para dos cosas: saber que el aviso llegó Y se abrió, que es lo que el
 * registro no puede saber solo, y dejarlo leído. Antes, abrir el push de un
 * pedido vacío o de una sugerencia dejaba el contador encendido.
 */
export async function POST(req: Request) {
  if (!mismoOrigen(req.headers)) return NextResponse.json({ ok: false }, { status: 403 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  let body: { d?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (typeof body.d !== "string" || body.d.length === 0 || body.d.length > 64) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const ok = await registrarApertura(user.id, body.d);
  return NextResponse.json({ ok });
}
