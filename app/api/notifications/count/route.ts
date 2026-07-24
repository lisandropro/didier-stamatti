import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Devuelve la cantidad de avisos sin leer del usuario actual (para la insignia
// de la campana; el menú la consulta cada tanto).
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ count: 0 }, { status: 200 });
  const count = await prisma.notification.count({ where: { recipientId: user.id, read: false } });
  return NextResponse.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
