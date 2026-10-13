"use client";
import { useEffect, useState } from "react";
import { clearDraft, readDraft, writeDraft } from "@/lib/session-draft";
export function useSessionDraft<T extends Record<string, string | boolean>>(key: string, initial: T) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      const saved = readDraft<T>(key);
      if (saved && Object.keys(initial).every((field) => typeof saved[field] === typeof initial[field])) setValue(saved);
    });
    return () => { alive = false; };
  // Los valores iniciales son constantes; la clave identifica el borrador.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  function setField<K extends keyof T>(field: K, next: T[K]) {
    const updated = { ...value, [field]: next };
    writeDraft(key, updated);
    setValue(updated);
  }
  return { value, setField, clear: () => clearDraft(key) };
}
