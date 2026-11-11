import { cookies } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { duraUnMes, issueSessionToken, resolveSessionToken, type SessionUser } from "./session-token";

export type { SessionUser } from "./session-token";
const COOKIE = "didier_session";

export async function createSession(user: SessionUser & { passwordHash: string }, remember: boolean) {
  // Se firma la credencial que se verificó: releerla aquí permitiría iniciar
  // sesión con la contraseña anterior si se cambia mientras bcrypt trabaja.
  const token = await issueSessionToken(user, remember);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/",
    ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
  });
}

/**
 * Vuelve a firmar la sesión de este navegador con la contraseña nueva.
 *
 * La sesión va atada a la contraseña: al cambiarla, todas dejan de valer. La
 * de quien la acaba de cambiar tiene que seguir, con la misma duración que
 * tenía ("Recordarme" o no).
 */
export async function renovarSesion(user: SessionUser & { passwordHash: string }) {
  const actual = (await cookies()).get(COOKIE)?.value;
  await createSession(user, actual ? duraUnMes(actual) : false);
}

export async function destroySession() { (await cookies()).delete(COOKIE); }

// React cache dura solo el render, sin conservar permisos entre solicitudes.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return resolveSessionToken(token, (id) => prisma.user.findUnique({
    where: { id }, select: { id: true, name: true, email: true, role: true, passwordHash: true },
  }));
});

export const sesionVigente = getSessionUser;
