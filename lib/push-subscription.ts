const HOSTS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);

/** El servidor nunca debe enviar Web Push a una URL arbitraria del cliente. */
export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash &&
      (HOSTS.has(url.hostname) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname));
  } catch { return false; }
}

export function parsePushSubscription(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const input = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const p256dh = input.keys?.p256dh;
  const auth = input.keys?.auth;
  if (!validPushEndpoint(input.endpoint) || typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (!/^[A-Za-z0-9_-]{87}=?$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}(==)?$/.test(auth)) return null;
  const key = Buffer.from(p256dh, "base64url");
  if (key.length !== 65 || key[0] !== 4 || Buffer.from(auth, "base64url").length !== 16) return null;
  return { endpoint: input.endpoint, p256dh, auth };
}
