import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { appVersion } from "@/lib/app-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Devuelve los avisos sin leer y la versión que está corriendo. Van juntos a
// propósito: es la única consulta periódica que hace la app, y sirve para las
// dos cosas sin gastar otra petición de datos en el celular.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ count: 0, version: appVersion() }, { status: 200 });
  const count = await prisma.notification.count({ where: { recipientId: user.id, read: false } });
  return NextResponse.json({ count, version: appVersion() }, { headers: { "Cache-Control": "no-store" } });
}
