import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Nada de lo que corre en el servidor puede leer una fecha con la zona del
 * proceso.
 *
 * `lib/dates.ts` existe para eso y `tests/dates.test.ts` lo prueba relanzándolo
 * en cuatro zonas. Pero hasta noviembre de 2026 quedaba `lib/format.ts`, con
 * `getDay()`/`getHours()`/`getDate()`, y lo usaban la hoja impresa del pedido,
 * los carteles, el PDF y las pantallas de avisos y sugerencias. Con el servidor
 * en UTC, un evento del sábado 15/8 a las 21 hs salía "Dom 16/8 · 0hs" en el
 * papel que lee el depósito. La prueba de zonas no lo veía porque ese archivo
 * no era el que probaba.
 *
 * Esta prueba mira el texto: en `app/` y en `lib/` (lo que corre en el
 * servidor) no puede aparecer ningún lector local de `Date`. Los componentes
 * (`components/`) corren en el teléfono, que sí está en Argentina, y quedan
 * afuera a propósito.
 */

const RAIZ = path.resolve(__dirname, "..");

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) {
      // El cliente de Prisma es generado: no es código de la app.
      if (e.name === "generated" || e.name === "node_modules") continue;
      out.push(...archivos(ruta));
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(ruta);
    }
  }
  return out;
}

/** Los lectores y formateadores de `Date` que contestan en la zona del proceso.
 *  Los `getUTC*` no entran: `lib/dates` los usa para aritmética de calendario. */
const LOCALES = /\.(getDay|getDate|getMonth|getFullYear|getHours|getMinutes|setHours|toLocaleDateString|toLocaleTimeString|toDateString|toTimeString)\(/;

test("lib/format.ts ya no existe y nadie lo importa", () => {
  assert.equal(fs.existsSync(path.join(RAIZ, "lib", "format.ts")), false, "lib/format.ts volvió: usaba la zona del servidor");
  for (const dir of ["app", "lib", "components"]) {
    for (const f of archivos(path.join(RAIZ, dir))) {
      const texto = fs.readFileSync(f, "utf8");
      assert.doesNotMatch(texto, /from ["'](@\/lib|\.|\.\.\/lib)\/format["']/, `${path.relative(RAIZ, f)} importa lib/format`);
    }
  }
});

test("el código del servidor no lee fechas con la zona del proceso", () => {
  const culpables: string[] = [];
  for (const dir of ["app", "lib"]) {
    for (const f of archivos(path.join(RAIZ, dir))) {
      const lineas = fs.readFileSync(f, "utf8").split(/\r?\n/);
      lineas.forEach((l, i) => {
        if (LOCALES.test(l)) culpables.push(`${path.relative(RAIZ, f)}:${i + 1}  ${l.trim()}`);
      });
    }
  }
  assert.deepEqual(
    culpables,
    [],
    "estas líneas dependen de la zona horaria del servidor; usar lib/dates (fmtEvento, fmtMomento, partesDe, diaDe):\n" + culpables.join("\n"),
  );
});

test("la hoja impresa, los carteles y el PDF escriben la fecha con fmtEvento", () => {
  for (const rel of [
    "app/(app)/evento/[id]/pdf/page.tsx",
    "app/(app)/evento/[id]/pdf/cartel/[sector]/page.tsx",
    "app/api/evento/[id]/pdf-file/route.ts",
  ]) {
    const texto = fs.readFileSync(path.join(RAIZ, rel), "utf8");
    assert.match(texto, /fmtEvento\(ev\.date\)/, `${rel} no usa fmtEvento para la fecha del evento`);
  }
});
