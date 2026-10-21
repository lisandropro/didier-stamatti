import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/** El barrido de faltantes corre solo, cada minuto, desde que arranca el servidor. */

function fuente(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidato = path.join(dir, rel);
    if (fs.existsSync(candidato)) return fs.readFileSync(candidato, "utf8");
    dir = path.dirname(dir);
  }
  throw new Error(`no se encontró ${rel}`);
}

test("el barrido de faltantes arranca con el servidor y corre cada minuto", () => {
  const s = fuente("instrumentation.ts");
  assert.match(s, /import\("@\/lib\/faltantes-db"\)/);
  assert.match(s, /void barrerFaltantesYAnotar\(\);/);
  assert.match(s, /setInterval\(\(\) => void barrerFaltantesYAnotar\(\), MINUTE\)/);
  // Fuera de la condición del respaldo: avisar que falta stock no depende de S3.
  assert.ok(s.indexOf("barrerFaltantesYAnotar") < s.indexOf("if (!process.env.BACKUP_S3_BUCKET)"));
});
