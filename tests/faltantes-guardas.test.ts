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
  //
  // Desde noviembre de 2026 hay tres lugares que crean un período: `createPeriod`
  // y, dentro de la misma transacción que el evento, `crearEventoUbicado` y
  // `corregirEvento` (lib/evento-db.ts). Los tres arman los datos con
  // `periodoNuevo`, que es donde vive la marca. Lo que se exige: que la marca
  // esté ahí, y que NADIE cree un período armando los datos por su cuenta.
  assert.match(
    fuente("lib/evento-db.ts"),
    /export function periodoNuevo\([^)]*\)\s*\{\s*return \{[^}]*faltantesDesde: new Date\(\)[^}]*\};/,
    "periodoNuevo ya no hace nacer el período con faltantesDesde",
  );
  const archivos = [...fuentesDe("app"), ...fuentesDe("lib")].filter((f) => !f.includes("generated"));
  let creaciones = 0;
  for (const f of archivos) {
    for (const llamada of fuente(f).match(/operationalPeriod\.create\([^;]*\)/g) ?? []) {
      creaciones++;
      assert.match(llamada, /data: periodoNuevo\(/, `${f} crea un período sin pasar por periodoNuevo: ${llamada}`);
    }
  }
  assert.ok(creaciones >= 3, `se esperaban createPeriod, crearEventoUbicado y corregirEvento; se encontraron ${creaciones} creaciones`);
  // Con la forma `createMany` tampoco: no la usa nadie y no pasaría por la marca.
  assert.deepEqual(archivos.filter((f) => /operationalPeriod\.createMany/.test(fuente(f))), []);
});

test("el subtítulo de Avisos no dice que todo lo cambió el equipo", () => {
  // Los avisos de faltante los firma "Sistema": nadie del equipo los hizo.
  const s = fuente("app/(app)/notificaciones/page.tsx");
  assert.match(s, /<div className="sub">Cambios en los pedidos, faltantes de stock y levantes<\/div>/);
  assert.doesNotMatch(s, /hechos por el equipo/);
});
