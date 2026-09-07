import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { issueSessionToken, resolveSessionToken } from "../lib/session-token";
import { createLoginLimiter } from "../lib/login-limit";
import { parsePushSubscription, validPushEndpoint } from "../lib/push-subscription";

process.env.AUTH_SECRET = "test-only-secret-never-use-in-production-12345678";
const account = { id: "test-admin", name: "Prueba", role: "ADMIN", email: "test@example.test", passwordHash: "hash-inicial" };

test("la sesión usa el rol y nombre actuales, sin exponer el hash", async () => {
  const token = await issueSessionToken(account, true);
  const resolved = await resolveSessionToken(token, async () => ({ ...account, name: "Nuevo nombre", role: "RECEPCION" }));
  assert.deepEqual(resolved, { id: account.id, name: "Nuevo nombre", role: "RECEPCION", email: account.email });
});
test("borrar al usuario, cambiar contraseña o un rol inválido revoca acceso", async () => {
  const token = await issueSessionToken(account, false);
  assert.equal(await resolveSessionToken(token, async () => null), null);
  assert.equal(await resolveSessionToken(token, async () => ({ ...account, passwordHash: "otra" })), null);
  assert.equal(await resolveSessionToken(token, async () => ({ ...account, role: "DESCONOCIDO" })), null);
  assert.equal(await resolveSessionToken(token, async () => { throw new Error("DB offline"); }), null);
});
test("rechaza tokens alterados, vencidos y sesiones antiguas sin revocación", async () => {
  const token = await issueSessionToken(account, false);
  assert.equal(await resolveSessionToken(token + "x", async () => account), null);
  const old = await new SignJWT({ ...account }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("8h").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  assert.equal(await resolveSessionToken(old, async () => account), null);
  const expired = await new SignJWT({ id: account.id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt(0).setExpirationTime(1).sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  assert.equal(await resolveSessionToken(expired, async () => account), null);
});
test("sin secreto suficiente no se emiten ni aceptan sesiones", async () => {
  const original = process.env.AUTH_SECRET;
  try {
    for (const value of [undefined, "corto"]) {
      if (value === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = value;
      await assert.rejects(issueSessionToken(account, false), /AUTH_SECRET/);
      assert.equal(await resolveSessionToken("invalid", async () => account), null);
    }
  } finally { process.env.AUTH_SECRET = original; }
});
test("límite de login expira y no permite eludirlo llenando la memoria", () => {
  const limiter = createLoginLimiter(2, 100, 2);
  assert.equal(limiter.take("a", 0), true);
  assert.equal(limiter.take("a", 1), true);
  assert.equal(limiter.take("a", 2), false);
  assert.equal(limiter.take("b", 2), true);
  assert.equal(limiter.take("c", 3), false);
  assert.equal(limiter.take("a", 3), false);
  assert.equal(limiter.take("c", 102), true);
  assert.equal(limiter.take("a", 102), true);
  limiter.clear("a");
  assert.equal(limiter.take("a", 103), true);
});
test("Web Push solo permite los servicios conocidos, sin URLs internas ni credenciales", () => {
  for (const endpoint of ["https://fcm.googleapis.com/fcm/send/test", "https://updates.push.services.mozilla.com/wpush/v2/test", "https://web.push.apple.com/test", "https://wns2-test.notify.windows.com/test"]) assert.equal(validPushEndpoint(endpoint), true, endpoint);
  for (const endpoint of ["http://fcm.googleapis.com/x", "https://127.0.0.1/", "https://localhost/", "https://10.0.0.1/", "https://fcm.googleapis.com.evil.test/", "https://fcm.googleapis.com@evil.test/", "https://user@fcm.googleapis.com/", "https://fcm.googleapis.com:444/", "https://evil.test/", null, {}, 4]) assert.equal(validPushEndpoint(endpoint), false);
});
test("suscripciones malformed y claves inválidas se rechazan", () => {
  for (const value of [null, {}, [], { endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "x", auth: "x" } }]) assert.equal(parsePushSubscription(value), null);
  const key = Buffer.alloc(65, 1); key[0] = 4;
  assert.ok(parsePushSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: key.toString("base64url"), auth: Buffer.alloc(16).toString("base64url") } }));
});
