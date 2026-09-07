import { test } from "node:test";
import assert from "node:assert/strict";
import { AutosaveQueue } from "../lib/autosave";

test("tipear 1, 10 y 100 guarda una sola vez el último valor", async () => {
  const sent: number[] = []; let balance = 0;
  const queue = new AutosaveQueue<number>(async (v) => { sent.push(v); return { ok: true }; }, 60_000, () => balance++, () => balance--);
  queue.schedule("plato", 1); queue.schedule("plato", 10); queue.schedule("plato", 100);
  assert.equal(queue.getSnapshot().pending, 1);
  assert.equal(balance, 1);
  assert.equal(await queue.flush(), true);
  assert.deepEqual(sent, [100]); assert.equal(balance, 0);
});
test("una escritura lenta no puede terminar después de la cantidad nueva", async () => {
  const sent: number[] = []; let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queue = new AutosaveQueue<number>(async (v) => { sent.push(v); if (v === 1) await gate; return { ok: true }; }, 60_000);
  queue.schedule("a", 1); const first = queue.flush();
  queue.schedule("a", 2); queue.schedule("a", 3);
  assert.deepEqual(sent, [1]); release();
  assert.equal(await first, true); assert.deepEqual(sent, [1, 3]);
});
test("error de red conserva el valor y permite reintentar sin falso Guardado", async () => {
  let fail = true; let balance = 0; const sent: number[] = [];
  const queue = new AutosaveQueue<number>(async (v) => { if (fail) throw new Error("offline"); sent.push(v); return { ok: true }; }, 60_000, () => balance++, () => balance--);
  queue.schedule("a", 80); assert.equal(await queue.flush(), false);
  assert.equal(queue.getSnapshot().saved, false); assert.ok(queue.getSnapshot().error); assert.equal(balance, 1);
  fail = false; assert.equal(await queue.flush(), true); assert.equal(balance, 0); assert.deepEqual(sent, [80]);
});
test("un éxito en otro producto no oculta el error pendiente", async () => {
  const queue = new AutosaveQueue<number>(async (v) => ({ ok: v !== 1, error: v === 1 ? "Sin permiso" : undefined }), 60_000);
  queue.schedule("a", 1); queue.schedule("b", 2);
  assert.equal(await queue.flush(), false); assert.equal(queue.getSnapshot().error, "Sin permiso");
  await queue.cancel("a"); assert.equal(queue.getSnapshot().pending, 0);
});
test("borrar un extra cancela el debounce pendiente antes de eliminarlo", async () => {
  const sent: number[] = [];
  const queue = new AutosaveQueue<number>(async (v) => { sent.push(v); return { ok: true }; }, 60_000);
  queue.schedule("a", 4); await queue.cancel("a"); await queue.flush(); assert.deepEqual(sent, []);
});
test("salir de la pantalla vacía la cola y no deja bloqueada la actualización", async () => {
  let balance = 0;
  const queue = new AutosaveQueue<number>(async () => ({ ok: false }), 60_000, () => balance++, () => balance--);
  queue.schedule("a", 4); await queue.close(); assert.equal(balance, 0);
});
