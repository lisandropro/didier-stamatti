import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { revisarArchivo } from "../lib/verificar-respaldo";

/**
 * Que el respaldo se pueda restaurar.
 *
 * **Lo que se prueba acá es que DETECTE lo que está mal.** Una prueba de que la
 * función "corre sin error" contra una base sana no prueba nada: eso es lo que
 * ya hacía el control de antigüedad, que da por bueno cualquier archivo con
 * fecha reciente.
 *
 * Los tres modos en que un respaldo se rompe callado —truncado, vacío, o que
 * directamente no es SQLite— pasan el control de antigüedad sin quejarse. Acá
 * hay un caso por cada uno.
 */

const DIR = path.join(os.tmpdir(), `didier-verif-${process.pid}`);

function nuevoArchivo(nombre: string): string {
  fs.mkdirSync(DIR, { recursive: true });
  return path.join(DIR, nombre);
}

/** Una base sana, con la tabla testigo y una fila adentro. */
function baseSana(nombre: string): string {
  const ruta = nuevoArchivo(nombre);
  fs.rmSync(ruta, { force: true });
  const db = new Database(ruta);
  db.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT)`);
  db.prepare(`INSERT INTO "User" (id, name) VALUES (?, ?)`).run("u1", "Aldana");
  db.close();
  return ruta;
}

test("una copia sana pasa", () => {
  assert.equal(revisarArchivo(baseSana("sana.db"), "User"), null);
});

test("una copia TRUNCADA no pasa", () => {
  // El modo de falla más probable: la subida se corta a la mitad. El archivo
  // existe, tiene fecha de hoy, y el control de antigüedad lo da por bueno.
  const ruta = baseSana("truncada.db");
  const bytes = fs.readFileSync(ruta);
  fs.writeFileSync(ruta, bytes.subarray(0, Math.floor(bytes.length / 2)));

  const r = revisarArchivo(ruta, "User");
  assert.ok(r, "dio por buena una base cortada a la mitad");
  assert.ok(["corrupta", "no-abre", "sin-tabla"].includes(r.code), `código inesperado: ${r.code}`);
});

test("una base bien formada pero VACÍA no pasa", () => {
  // Éste es el caso traicionero: pasa `integrity_check` sin una queja. Se
  // respalda una base recién creada y el archivo es perfecto — y no tiene nada.
  const ruta = nuevoArchivo("vacia.db");
  fs.rmSync(ruta, { force: true });
  const db = new Database(ruta);
  db.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT)`);
  db.close();

  const r = revisarArchivo(ruta, "User");
  assert.ok(r, "dio por buena una base sin ninguna fila");
  assert.equal(r.code, "vacia");
});

test("un archivo que NO es SQLite no pasa", () => {
  const ruta = nuevoArchivo("basura.db");
  fs.writeFileSync(ruta, "esto no es una base de datos");
  const r = revisarArchivo(ruta, "User");
  assert.ok(r);
  assert.ok(["no-abre", "corrupta"].includes(r.code), `código inesperado: ${r.code}`);
});

test("una copia sin la tabla testigo no pasa", () => {
  // Abre perfecto y tiene datos, pero de otra cosa: es el respaldo del stock
  // guardado en el prefijo de comprobantes, o al revés.
  const ruta = nuevoArchivo("otra.db");
  fs.rmSync(ruta, { force: true });
  const db = new Database(ruta);
  db.exec(`CREATE TABLE "Otra" (id TEXT PRIMARY KEY)`);
  db.prepare(`INSERT INTO "Otra" (id) VALUES (?)`).run("x");
  db.close();

  const r = revisarArchivo(ruta, "User");
  assert.ok(r);
  assert.equal(r.code, "sin-tabla");
});

test("un archivo que no existe no pasa", () => {
  const r = revisarArchivo(path.join(DIR, "no-esta.db"), "User");
  assert.ok(r);
  assert.equal(r.code, "no-abre");
});

test("no deja el archivo abierto", () => {
  // En Windows un archivo con la conexión abierta no se puede borrar, y esto
  // corre todos los días sobre decenas de megas: una conexión filtrada por día
  // llena el disco del contenedor.
  const ruta = baseSana("cierra.db");
  revisarArchivo(ruta, "User");
  fs.rmSync(ruta); // si quedara abierto, en Windows esto tira EBUSY
  assert.equal(fs.existsSync(ruta), false);
});
