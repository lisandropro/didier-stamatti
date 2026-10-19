import { prisma } from "@/lib/db";
import { ROLES } from "@/lib/permissions";
import { deviceSummary } from "@/lib/suggestions";

// A quién le llegan los avisos y a quién no, para la pantalla Dispositivos.
//
// Hasta el 19/10/2026 un push que fallaba no dejaba rastro: del 07/09 al 19/10
// ningún teléfono pudo activar los avisos, y al 18/10 Aldana no tenía ningún
// dispositivo. Nada lo mostraba.

/** Con cuántos fracasos seguidos se da por hecho que a un teléfono no le llega. */
export const FALLOS_PARA_ALARMA = 3;

/** `ultimos` va del más nuevo al más viejo. Uno aceptado en el medio alcanza
 *  para decir que llega: los fracasos sueltos son ruido de la red. */
export function noLeLlega(ultimos: { status: string }[]): boolean {
  if (ultimos.length < FALLOS_PARA_ALARMA) return false;
  return ultimos.slice(0, FALLOS_PARA_ALARMA).every((e) => e.status !== "ACEPTADO");
}

export type DispositivoVista = {
  id: string;
  descripcion: string;
  alta: Date;
  lastOkAt: Date | null;
  lastErrorAt: Date | null;
  noLeLlega: boolean;
};

export type PersonaVista = { id: string; name: string; role: string; dispositivos: DispositivoVista[] };

/** Cada persona con un rol vigente y sus dispositivos. Arriba, lo que hay que
 *  resolver: quien no tiene ninguno, y quien tiene uno al que no le llega. */
export async function estadoDeDispositivos(): Promise<PersonaVista[]> {
  const usuarios = await prisma.user.findMany({
    where: { role: { in: [...ROLES] } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: usuarios.map((u) => u.id) } },
    orderBy: { createdAt: "asc" },
  });

  const personas: PersonaVista[] = [];
  for (const u of usuarios) {
    const dispositivos: DispositivoVista[] = [];
    for (const s of subs.filter((x) => x.userId === u.id)) {
      const ultimos = await prisma.pushDelivery.findMany({
        where: { subscriptionId: s.id },
        orderBy: { createdAt: "desc" },
        take: FALLOS_PARA_ALARMA,
        select: { status: true },
      });
      dispositivos.push({
        id: s.id,
        descripcion: deviceSummary(s.userAgent ?? ""),
        alta: s.createdAt,
        lastOkAt: s.lastOkAt,
        lastErrorAt: s.lastErrorAt,
        noLeLlega: noLeLlega(ultimos),
      });
    }
    personas.push({ ...u, dispositivos });
  }

  const urgencia = (p: PersonaVista) =>
    p.dispositivos.length === 0 ? 0 : p.dispositivos.some((d) => d.noLeLlega) ? 1 : 2;
  return personas.sort((a, b) => urgencia(a) - urgencia(b) || a.name.localeCompare(b.name, "es"));
}
