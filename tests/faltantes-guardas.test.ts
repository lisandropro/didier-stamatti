import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/** El barrido de faltantes corre solo, cada minuto, desde que arranca el servidor. */

function ruta(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidato = path.join(dir, rel);
    if (fs.existsSync(candidato)) return candidato;
    dir = path.dirname(dir);
  }
  throw new Error(`no se encontró ${rel}`);
}

const fuente = (rel: string): string => fs.readFileSync(ruta(rel), "utf8");

/** Los .ts y .tsx de una carpeta, con sus subcarpetas. */
function fuentesDe(rel: string): string[] {
  return (fs.readdirSync(ruta(rel), { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => path.join(rel, f));
}

test("el barrido de faltantes arranca con el servidor y corre cada minuto", () => {
  const s = fuente("instrumentation.ts");
  assert.match(s, /import\("@\/lib\/faltantes-db"\)/);
  assert.match(s, /void barrerFaltantesYAnotar\(\);/);
  assert.match(s, /setInterval\(\(\) => void barrerFaltantesYAnotar\(\), MINUTE\)/);
  // Fuera de la condición del respaldo: avisar que falta stock no depende de S3.
  assert.ok(s.indexOf("barrerFaltantesYAnotar") < s.indexOf("if (!process.env.BACKUP_S3_BUCKET)"));
});

test("un período nuevo nace con faltantesDesde: su primer pedido avisa", () => {
  // `faltantesDesde` nulo quiere decir una sola cosa: el período ya existía
  // cuando se desplegó el aviso, y su primer barrido registra sin avisar. Un
  // período creado después nace marcado; si no, los faltantes de su primer
  // pedido (copiar es un toque) se registrarían en silencio.
  const s = fuente("app/actions/period.ts");
  const creaciones = s.match(/prisma\.operationalPeriod\.create\([^;]*\);/g) ?? [];
  assert.equal(creaciones.length, 1, "createPeriod es el único lugar que crea períodos (createEvent y updateEvent pasan por él)");
  assert.match(creaciones[0], /faltantesDesde: new Date\(\)/);
  // Nada más crea períodos por su cuenta (lo generado por Prisma no cuenta).
  const otros = [...fuentesDe("app"), ...fuentesDe("lib")]
    .filter((f) => !f.includes("generated") && !f.endsWith(path.join("actions", "period.ts")))
    .filter((f) => /operationalPeriod\.create/.test(fuente(f)));
  assert.deepEqual(otros, []);
});
