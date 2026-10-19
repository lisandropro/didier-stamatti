import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Guardas de las rutas y acciones de avisos, sobre el texto de los archivos.
 *
 * Las rutas leen la sesión de las cookies y no corren fuera de Next. Lo que se
 * fija acá es el orden: primero el origen, después la sesión, después escribir.
 */

function fuente(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidato = path.join(dir, rel);
    if (fs.existsSync(candidato)) return fs.readFileSync(candidato, "utf8");
    dir = path.dirname(dir);
  }
  throw new Error(`no se encontró ${rel}`);
}

test("abrir un aviso exige mismo origen y sesión, y marca solo lo propio", () => {
  const s = fuente("app/api/notifications/abierto/route.ts");
  const origen = s.indexOf("mismoOrigen(");
  const sesion = s.indexOf("getSessionUser(");
  const escritura = s.indexOf("registrarApertura(");
  assert.ok(origen > -1 && sesion > origen && escritura > sesion, "el orden tiene que ser origen, sesión, escritura");
  assert.match(s, /registrarApertura\(user\.id,/, "tiene que marcar con el id de la sesión, no con uno que mande el cliente");
});

test("la suscripción guarda de qué navegador viene", () => {
  assert.match(fuente("app/api/notifications/subscribe/route.ts"), /user-agent/);
});

test("probar un teléfono exige sesión y prueba solo los propios", () => {
  const s = fuente("app/actions/notifications.ts");
  const cuerpo = s.slice(s.indexOf("export async function probarEsteDispositivo"));
  assert.ok(cuerpo.indexOf("getSessionUser(") < cuerpo.indexOf("enviarPrueba("));
  assert.match(cuerpo, /enviarPrueba\(user\.id,/);
});
