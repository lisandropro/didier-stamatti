import { createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
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
