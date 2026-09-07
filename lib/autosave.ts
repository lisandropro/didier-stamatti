import { avisarDeFalloAlGuardar, mensajeDeFallo } from "./actualizacion";

type Result = { ok: boolean; error?: string };
type Entry<T> = { value: T; revision: number; timer?: ReturnType<typeof setTimeout>; running?: Promise<void>; error?: string };
export type SaveStatus = { pending: number; error: string | null; saved: boolean };

/** Una escritura por clave a la vez. Conserva el último valor hasta confirmarlo. */
export class AutosaveQueue<T> {
  private entries = new Map<string, Entry<T>>();
  private listeners = new Set<() => void>();
  private status: SaveStatus = { pending: 0, error: null, saved: false };
  constructor(private save: (value: T) => Promise<Result>, private delay = 700,
    private started = () => {}, private finished = () => {}) {}

  getSnapshot = () => this.status;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(saved = this.status.saved) {
    this.status = { pending: this.entries.size, error: [...this.entries.values()].find((e) => e.error)?.error ?? null, saved };
    for (const listener of this.listeners) listener();
  }
  schedule(key: string, value: T) {
    let entry = this.entries.get(key);
    if (!entry) { entry = { value, revision: 0 }; this.entries.set(key, entry); this.started(); }
    entry.value = value;
    entry.revision++;
    entry.error = undefined;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { entry!.timer = undefined; void this.run(key); }, this.delay);
    this.emit();
  }
  private run(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve();
    if (entry.running) return entry.running;
    entry.running = (async () => {
      while (this.entries.get(key) === entry) {
        clearTimeout(entry.timer);
        entry.timer = undefined;
        const revision = entry.revision;
        let result: Result;
        try { result = await this.save(entry.value); }
        catch (error) {
          result = { ok: false, error: mensajeDeFallo(error) };
          avisarDeFalloAlGuardar(error);
        }
        if (revision !== entry.revision) continue;
        if (!result.ok) { entry.error = result.error ?? "No se pudo guardar. Reintentá."; break; }
        this.entries.delete(key);
        this.finished();
        this.emit(true);
      }
    })().finally(() => { entry.running = undefined; this.emit(); });
    return entry.running;
  }
  async flush(): Promise<boolean> {
    await Promise.all([...this.entries.keys()].map((key) => this.run(key)));
    return this.entries.size === 0;
  }
  /** Espera escrituras en curso antes de borrar una línea. */
  async cancel(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    await entry.running;
    if (this.entries.get(key) === entry) { this.entries.delete(key); this.finished(); this.emit(); }
  }
  async close() {
    await this.flush();
    for (const key of this.entries.keys()) await this.cancel(key);
  }
}
