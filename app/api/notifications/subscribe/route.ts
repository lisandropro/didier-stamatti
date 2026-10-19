import { parsePushSubscription, validPushEndpoint } from "@/lib/push-subscription";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { mismoOrigen } from "@/lib/mismo-origen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Guarda (o actualiza) la suscripción push de este dispositivo para el usuario actual.
export async function POST(req: Request) {
  if (!mismoOrigen(req.headers)) return NextResponse.json({ ok: false }, { status: 403 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Datos inválidos." }, { status: 400 });
  }

  const subscription = parsePushSubscription(body);
  if (!subscription) return NextResponse.json({ ok: false, error: "Suscripción inválida." }, { status: 400 });
  const { endpoint, p256dh, auth } = subscription;
  // De qué navegador viene, para mostrarlo en Dispositivos. Se renueva en cada
  // apertura de la app (PushSubscriptionSync).
  const userAgent = req.headers.get("user-agent")?.slice(0, 300) || null;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: user.id, p256dh, auth, userAgent },
    create: { userId: user.id, endpoint, p256dh, auth, userAgent },
  });

  return NextResponse.json({ ok: true });
}

// Quita la suscripción de este dispositivo (al desactivar las notificaciones).
export async function DELETE(req: Request) {
  if (!mismoOrigen(req.headers)) return NextResponse.json({ ok: false }, { status: 403 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  let body: { endpoint?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (body && validPushEndpoint(body.endpoint)) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: user.id } });
  }
  return NextResponse.json({ ok: true });
}
