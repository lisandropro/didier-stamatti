// Borradores de esta pestaña, separados por cuenta; vencen a las doce horas.
const MAX_AGE = 12 * 60 * 60 * 1000;
function storage() { return typeof window === "undefined" ? null : window.sessionStorage; }
export function readDraft<T>(key: string): T | null {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record.version !== 1 || typeof record.at !== "number" || Date.now() - record.at > MAX_AGE) {
      clearDraft(key); return null;
    }
    return record.value as T;
  } catch { return null; }
}
export function writeDraft(key: string, value: unknown) {
  try { storage()?.setItem(key, JSON.stringify({ version: 1, at: Date.now(), value })); } catch {}
}
export function clearDraft(key: string) {
  try { storage()?.removeItem(key); } catch {}
}
