import { test } from "node:test";
import assert from "node:assert/strict";
import { readDraft, writeDraft, clearDraft } from "../lib/session-draft";

test("un borrador sobrevive la recarga, se separa por cuenta y se borra al guardar", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) };
  Object.defineProperty(globalThis, "window", { value: { sessionStorage: storage }, configurable: true });
  try {
    writeDraft("new-period:enrique", { startDay: "2026-10-14", endDay: "2026-10-16" });
    assert.deepEqual(readDraft("new-period:enrique"), { startDay: "2026-10-14", endDay: "2026-10-16" });
    assert.equal(readDraft("new-period:aldana"), null);
    clearDraft("new-period:enrique");
    assert.equal(readDraft("new-period:enrique"), null);
  } finally { Reflect.deleteProperty(globalThis, "window"); }
});

test("datos vencidos, dañados o almacenamiento bloqueado no traban la app", () => {
  const data = new Map<string, string>([
    ["old", JSON.stringify({ version: 1, at: Date.now() - 13 * 60 * 60 * 1000, value: { qty: 10 } })],
    ["bad", "no es json"],
  ]);
  Object.defineProperty(globalThis, "window", { value: { sessionStorage: { getItem: (k: string) => data.get(k), removeItem: (k: string) => data.delete(k) } }, configurable: true });
  try {
    assert.equal(readDraft("old"), null); assert.equal(data.has("old"), false);
    assert.equal(readDraft("bad"), null);
    Object.defineProperty(globalThis, "window", { value: { get sessionStorage() { throw new Error("blocked"); } }, configurable: true });
    assert.doesNotThrow(() => writeDraft("x", { qty: 10 }));
    assert.equal(readDraft("x"), null);
    assert.doesNotThrow(() => clearDraft("x"));
  } finally { Reflect.deleteProperty(globalThis, "window"); }
});

