/** Límite por cuenta y por proceso. Para varias réplicas, compartir en proxy/base. */
export function createLoginLimiter(limit = 10, windowMs = 15 * 60_000, capacity = 5_000) {
  const attempts = new Map<string, { count: number; until: number }>();
  return {
    take(key: string, now = Date.now()): boolean {
      const current = attempts.get(key);
      if (current && current.until > now) {
        if (current.count >= limit) return false;
        current.count++;
        return true;
      }
      if (attempts.size >= capacity) {
        for (const [k, value] of attempts) if (value.until <= now) attempts.delete(k);
        if (!attempts.has(key) && attempts.size >= capacity) return false;
      }
      attempts.set(key, { count: 1, until: now + windowMs });
      return true;
    },
    clear(key: string) { attempts.delete(key); },
  };
}
export const loginLimiter = createLoginLimiter();
