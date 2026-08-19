/**
 * Aplica la vuelta atrás de "stock sin recuento" sobre una base, comprobando
 * antes y después.
 *
 * Se niega a seguir si algo no cierra: es un guion para un mal momento, y en un
 * mal momento nadie está para leer con calma lo que salió raro. Mejor que no
 * haga nada a que deje la base a medias.
 *
 *   node --import tsx scripts/reversion/revertir-stock-sin-recuento.ts <base.db>
 *
 * Siempre sobre una copia primero.
 */

// better-sqlite3 y no node:sqlite: es la misma que usa la app en producción
// (a través del adaptador de Prisma) y trae tipos, así que este guion entra en
// la comprobación de tipos como cualquier otro archivo.
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";

const ruta = process.argv[2];
if (!ruta) {
  console.error("Falta la ruta a la base. Ejemplo: ... revertir-stock-sin-recuento.ts copia.db");
  process.exit(1);
}

const db = new Database(ruta);
const uno = <T>(sql: string): T => db.prepare(sql).get() as T;

// --- Antes -----------------------------------------------------------------
const integridadAntes = uno<{ integrity_check: string }>("pragma integrity_check").integrity_check;
if (integridadAntes !== "ok") {
  console.error(`La base no está sana antes de empezar: ${integridadAntes}. No se toca nada.`);
  process.exit(1);
}

const columnas = db.prepare("pragma table_info('Product')").all() as { name: string; notnull: number }[];
const stockCol = columnas.find((c) => c.name === "stock");
if (!stockCol) {
  console.error("Esta base no tiene la columna Product.stock. No se toca nada.");
  process.exit(1);
}
if (stockCol.notnull === 1) {
  console.log("Esta base ya está en el esquema viejo (stock NOT NULL): no hay nada que revertir.");
  process.exit(0);
}

const antes = {
  productos: uno<{ c: number }>("select count(*) c from Product").c,
  sinContar: uno<{ c: number }>("select count(*) c from Product where stock is null").c,
  conNumero: uno<{ c: number }>("select count(*) c from Product where stock is not null").c,
  suma: uno<{ s: number | null }>("select sum(stock) s from Product").s ?? 0,
  lineas: uno<{ c: number }>("select count(*) c from OrderLine").c,
  movimientos: uno<{ c: number }>("select count(*) c from StockMovement").c,
};
// Los números que hay que conservar tal cual, producto por producto.
const numerosAntes = new Map(
  (db.prepare("select id, stock from Product where stock is not null").all() as { id: string; stock: number }[]).map(
    (r) => [r.id, r.stock]
  )
);

console.log(`base: ${ruta}`);
console.log(`  productos ${antes.productos} · sin contar ${antes.sinContar} · con número ${antes.conNumero} · suma ${antes.suma}`);

// --- La vuelta atrás -------------------------------------------------------
const sql = readFileSync(path.join(import.meta.dirname, "revertir-stock-sin-recuento.sql"), "utf8");
db.exec(sql);

// --- Después ---------------------------------------------------------------
const problemas: string[] = [];
const integridad = uno<{ integrity_check: string }>("pragma integrity_check").integrity_check;
if (integridad !== "ok") problemas.push(`integridad: ${integridad}`);
if (db.prepare("pragma foreign_key_check").all().length > 0) problemas.push("quedaron claves foráneas rotas");

const despues = {
  productos: uno<{ c: number }>("select count(*) c from Product").c,
  enCero: uno<{ c: number }>("select count(*) c from Product where stock = 0").c,
  suma: uno<{ s: number | null }>("select sum(stock) s from Product").s ?? 0,
  lineas: uno<{ c: number }>("select count(*) c from OrderLine").c,
  movimientos: uno<{ c: number }>("select count(*) c from StockMovement").c,
};

if (despues.productos !== antes.productos) problemas.push(`se perdieron productos: ${antes.productos} -> ${despues.productos}`);
if (despues.lineas !== antes.lineas) problemas.push(`cambiaron las líneas de pedido: ${antes.lineas} -> ${despues.lineas}`);
if (despues.movimientos !== antes.movimientos) problemas.push(`cambiaron los movimientos: ${antes.movimientos} -> ${despues.movimientos}`);
if (despues.suma !== antes.suma) problemas.push(`cambió la suma de stock: ${antes.suma} -> ${despues.suma}`);

const nulos = uno<{ c: number }>("select count(*) c from Product where stock is null").c;
if (nulos !== 0) problemas.push(`quedaron ${nulos} productos en null`);

// Lo más importante: ningún número que existía puede haber cambiado.
for (const [id, valor] of numerosAntes) {
  const ahora = (db.prepare("select stock from Product where id = ?").get(id) as { stock: number } | undefined)?.stock;
  if (ahora !== valor) {
    problemas.push(`el producto ${id} cambió de ${valor} a ${ahora}`);
    break;
  }
}

console.log(`  después: ${despues.productos} productos · ${despues.enCero} en cero · suma ${despues.suma}`);
if (problemas.length > 0) {
  console.error("\nLA REVERSIÓN NO QUEDÓ BIEN:");
  for (const p of problemas) console.error("  · " + p);
  console.error("\nNo uses esta base. Restaurá el último respaldo del bucket.");
  process.exit(1);
}

console.log(`\nrevertida bien: los ${antes.sinContar} sin contar volvieron a 0 y ningún otro número se movió.`);
