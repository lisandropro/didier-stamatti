import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
const COOKIE = "didier_session";

export type SessionUser = { id: string; name: string; role: string; email: string };

export async function createSession(user: SessionUser, remember: boolean) {
  const token = await new SignJWT({
    id: user.id,
    name: user.name,
    role: user.role,
    email: user.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(remember ? "30d" : "8h")
    .sign(secret);

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // "Recordarme" => cookie persistente 30 días. Sin tilde => cookie de sesión
    // (se borra al cerrar el navegador) + el token expira en 8h.
    ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return {
      id: payload.id as string,
      name: payload.name as string,
      role: payload.role as string,
      email: payload.email as string,
    };
  } catch {
    return null;
  }
}

/**
 * La sesion, con el rol releido de la base.
 *
 * `getSessionUser` devuelve lo que dice el token, y el token dura hasta 30 dias.
 * Si a alguien se le baja el rol —o se lo borra— el token viejo sigue siendo
 * criptograficamente valido y sigue abriendo las mismas puertas durante un mes.
 *
 * Eso es tolerable para el stock. No lo es para plata: la promesa del modulo de
 * comprobantes es que quien recibe mercaderia no ve importes, y una promesa que
 * solo vale hasta que a alguien le cambian el rol no es una promesa, es una
 * demora de treinta dias.
 *
 * Devuelve `null` si el usuario ya no existe, y el rol de la BASE —no el del
 * token— si cambio. Cuesta una consulta por indice unico; el borde del dinero se
 * cruza pocas veces por minuto y la respuesta correcta vale mas que ese
 * milisegundo.
 *
 * Falla cerrado: si la base no responde, no hay sesion.
 */
export async function sesionVigente(): Promise<SessionUser | null> {
  const delToken = await getSessionUser();
  if (!delToken) return null;

  try {
    const { prisma } = await import("@/lib/db");
    const enLaBase = await prisma.user.findUnique({
      where: { id: delToken.id },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!enLaBase) return null;
    return enLaBase;
  } catch {
    return null;
  }
}
