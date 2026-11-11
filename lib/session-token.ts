import { createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT, decodeJwt, jwtVerify } from "jose";
import { isRole } from "./permissions";

export type SessionUser = { id: string; name: string; role: string; email: string };
type Account = SessionUser & { passwordHash: string };

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || Buffer.byteLength(value) < 32) throw new Error("AUTH_SECRET debe tener al menos 32 bytes.");
  return new TextEncoder().encode(value);
}

function credentialVersion(user: Account) {
  return createHmac("sha256", secret()).update(`${user.id}:${user.passwordHash}`).digest("hex");
}

export async function issueSessionToken(user: Account, remember: boolean) {
  return new SignJWT({ id: user.id, credentialVersion: credentialVersion(user) })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt()
    .setExpirationTime(remember ? "30d" : "8h").sign(secret());
}

/**
 * ¿Esta sesión se pidió con "Recordarme"? Se lee de su propia duración.
 *
 * No verifica la firma: solo sirve para renovar con la misma duración una
 * sesión que ya se comprobó en este mismo pedido. Ante cualquier duda, la corta.
 */
export function duraUnMes(token: string): boolean {
  try {
    const { exp, iat } = decodeJwt(token);
    return typeof exp === "number" && typeof iat === "number" && exp - iat > 8 * 60 * 60;
  } catch { return false; }
}

/** El rol siempre sale de la base. Cambiar la contraseña revoca los tokens anteriores. */
export async function resolveSessionToken(token: string, findUser: (id: string) => Promise<Account | null>): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"], requiredClaims: ["exp", "iat"] });
    if (typeof payload.id !== "string" || !payload.id || typeof payload.credentialVersion !== "string") return null;
    const user = await findUser(payload.id);
    if (!user || !isRole(user.role)) return null;
    const expected = Buffer.from(credentialVersion(user));
    const given = Buffer.from(payload.credentialVersion);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    return { id: user.id, name: user.name, role: user.role, email: user.email };
  } catch { return null; }
}
