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
