import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  CON_CARTEL,
  OPCIONES_CATEGORIA,
  esCategoria,
  llevaCartel,
  nombreDeCategoria,
  ordenDeCategoria,
} from "../lib/categories";

/**
 * Los sectores del depósito.
 *
 * Hasta que existió `lib/categories.ts`, la lista de categorías estaba escrita
 * a mano en catorce archivos. Olvidarse de uno no rompía nada ruidosamente: la
 * categoría simplemente no aparecía en esa pantalla, y eso se descubre el día
 * del evento, cuando falta la hoja del sector.
 *
 * La última prueba de este archivo es la que importa: barre el código fuente
 * buscando listas de categorías escritas a mano. Si alguien vuelve a copiar una,
 * falla acá y no en el depósito.
 */

test("Mantelería es un sector más, con su nombre bien escrito", () => {
  assert.ok(esCategoria("MANTELERIA"));
  assert.equal(nombreDeCategoria("MANTELERIA"), "Mantelería");
});

test("los cuatro sectores tienen nombre para mostrar", () => {
  for (const c of CATEGORIES) {
    assert.equal(typeof CATEGORY_LABEL[c], "string");
    assert.ok(CATEGORY_LABEL[c].length > 0, `${c} no tiene nombre`);
  }
  assert.equal(Object.keys(CATEGORY_LABEL).length, CATEGORIES.length, "sobra o falta un nombre");
});

test("una categoría inventada no pasa por válida", () => {
  assert.equal(esCategoria("MANTELERÍA"), false, "se compara la clave, no el nombre");
  assert.equal(esCategoria("manteleria"), false, "la clave va en mayúsculas");
  assert.equal(esCategoria("VAJILLA"), false);
  assert.equal(esCategoria(""), false);
});

test("un dato viejo con una categoría desconocida no rompe la pantalla", () => {
  // Se muestra tal cual y va al final del orden, nunca al principio: un producto
  // huérfano no puede encabezar el pedido.
  assert.equal(nombreDeCategoria("LO_QUE_SEA"), "LO_QUE_SEA");
  assert.ok(ordenDeCategoria("LO_QUE_SEA") >= CATEGORIES.length);
  assert.equal(llevaCartel("LO_QUE_SEA"), false);
});

test("el orden es el mismo en todas las pantallas y no tiene empates", () => {
  const ordenes = CATEGORIES.map(ordenDeCategoria);
  assert.deepEqual(ordenes, [...ordenes].sort((a, b) => a - b), "el orden no es el del arreglo");
  assert.equal(new Set(ordenes).size, CATEGORIES.length, "dos sectores comparten posición");
});

test("solo llevan cartel automático los sectores que se preparan aparte", () => {
  // El cartel es la hoja apaisada que se pega en el depósito. Si lo llevaran
  // todos, cada impresión saldría con hojas que nadie pega.
  for (const c of CON_CARTEL) assert.ok(esCategoria(c), `${c} no es una categoría`);
  assert.equal(llevaCartel("ENSERES"), true);
  assert.equal(llevaCartel("BEBIDA"), true);
  assert.equal(llevaCartel("MOBILIARIO"), false);
});

test("las opciones de los <select> son exactamente los sectores", () => {
  assert.deepEqual(OPCIONES_CATEGORIA.map((o) => o.v), [...CATEGORIES]);
  for (const o of OPCIONES_CATEGORIA) assert.equal(o.l, CATEGORY_LABEL[o.v]);
});

test("nadie volvió a escribir la lista de categorías a mano", () => {
  // Esta es la prueba que justifica el archivo. Se lee el código de verdad y se
  // exige que las categorías se nombren juntas SOLO en lib/categories.ts. Si
  // alguien copia la lista en una pantalla nueva —y se olvida de Mantelería—,
  // esto falla acá, no el día del evento.
  const raiz = path.join(import.meta.dirname, "..");
  const salteados = ["node_modules", ".next", "generated", "tests", "docs", ".git"];
  const sospechosos: string[] = [];

  const recorrer = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (salteados.some((s) => e.name.includes(s))) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (/\.tsx?$/.test(e.name)) {
        if (p.endsWith(path.join("lib", "categories.ts"))) continue;
        const fuente = fs.readFileSync(p, "utf8");
        // Dos claves de sector en la misma línea = una lista escrita a mano.
        for (const linea of fuente.split("\n")) {
          const claves = ["ENSERES", "MOBILIARIO", "BEBIDA", "MANTELERIA"].filter((c) => linea.includes(c));
          if (claves.length >= 2) sospechosos.push(`${path.relative(raiz, p)}: ${linea.trim().slice(0, 70)}`);
        }
      }
    }
  };
  recorrer(path.join(raiz, "app"));
  recorrer(path.join(raiz, "components"));
  recorrer(path.join(raiz, "lib"));

  assert.deepEqual(sospechosos, [], "hay listas de categorías fuera de lib/categories.ts");
});
