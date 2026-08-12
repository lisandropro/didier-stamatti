/**
 * Comprobación de la migración a períodos operativos: se corre ANTES y DESPUÉS
 * sobre la misma base y compara.
 *
 * Existe porque la migración renombra tablas y recrea la de eventos, y eso es
 * exactamente el tipo de cambio que puede perder o reasignar pedidos sin que
 * nadie lo note hasta que falte vajilla un sábado.
 *
 *   npx tsx scripts/verificar-migracion-periodos.ts antes  prod.db  > antes.json
 *   npx tsx scripts/verificar-migracion-periodos.ts despues prod.db > despues.json
 *   npx tsx scripts/verificar-migracion-periodos.ts comparar antes.json despues.json
 */
import Database from "better-sqlite3";
import fs from "node:fs";

type Foto = {
  totales: Record<string, number>;
  periodos: { id: string; label: string | null; desde: string; hasta: string; borrado: boolean }[];
  eventos: { id: string; lugar: string; periodo: string; dia: string; hora: string; borrado: boolean }[];
  lineasPorEvento: Record<string, number>;
  unidadesPorEvento: Record<string, number>;
  huellaDeLineas: string[];
};

const ZONA = "America/Argentina/Buenos_Aires";
const fmtDia = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" });
const fmtHora = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false });

function foto(archivo: string, etapa: "antes" | "despues"): Foto {
  const db = new Database(archivo, { readonly: true });
  const tablaPeriodo = etapa === "antes" ? "Weekend" : "OperationalPeriod";
  const colPeriodo = etapa === "antes" ? "weekendId" : "periodId";
  const tablaSnap = etapa === "antes" ? "WeekendSnapshot" : "PeriodSnapshot";
  const tablaVer = etapa === "antes" ? "WeekendVersion" : "PeriodVersion";

  const contar = (t: string) => (db.prepare(`select count(*) c from "${t}"`).get() as { c: number }).c;
  const totales = {
    periodos: contar(tablaPeriodo),
    eventos: contar("Event"),
    lineas: contar("OrderLine"),
    unidades: (db.prepare(`select coalesce(sum(qty),0) s from "OrderLine"`).get() as { s: number }).s,
    resguardos: contar(tablaSnap),
    versiones: contar(tablaVer),
    cambiosDePedido: contar("OrderChange"),
    avisos: contar("Notification"),
    movimientosDeStock: contar("StockMovement"),
    productos: contar("Product"),
    usuarios: contar("User"),
    sugerencias: contar("Suggestion"),
  };

  const periodos = (
    db
      .prepare(
        etapa === "antes"
          ? `select id, label, startDate as a, endDate as b, deletedAt from "Weekend" order by id`
          : `select id, label, startDay as a, endDay as b, deletedAt from "OperationalPeriod" order by id`
      )
      .all() as Record<string, unknown>[]
  )
    .map((r: Record<string, unknown>) => ({
      id: r.id as string,
      label: (r.label as string | null) ?? null,
      // Antes: instante en UTC -> su día son los primeros 10. Después: ya es el día.
      desde: String(r.a).slice(0, 10),
      hasta: String(r.b).slice(0, 10),
      borrado: r.deletedAt !== null,
    }));

  // La hora de pared de cada evento: antes se leía en UTC, después en Argentina.
  // Tiene que dar lo mismo — de eso se trata el ajuste de +3 horas.
  const eventos = (
    db
      .prepare(`select id, lugar, "${colPeriodo}" as periodo, date, deletedAt from "Event" order by id`)
      .all() as Record<string, unknown>[]
  )
    .map((r: Record<string, unknown>) => {
      const d = new Date(String(r.date));
      const enUTC = String(r.date).slice(0, 10) + " " + String(r.date).slice(11, 16);
      return {
        id: r.id as string,
        lugar: r.lugar as string,
        periodo: r.periodo as string,
        dia: etapa === "antes" ? enUTC.slice(0, 10) : fmtDia.format(d),
        hora: etapa === "antes" ? enUTC.slice(11) : fmtHora.format(d),
        borrado: r.deletedAt !== null,
      };
    });

  const lineasPorEvento: Record<string, number> = {};
  const unidadesPorEvento: Record<string, number> = {};
  for (const r of db
    .prepare(`select eventId, count(*) n, coalesce(sum(qty),0) u from "OrderLine" group by eventId`)
    .all() as { eventId: string; n: number; u: number }[]) {
    lineasPorEvento[r.eventId] = r.n;
    unidadesPorEvento[r.eventId] = r.u;
  }

  // Huella de cada renglón: si alguno se pierde, se duplica o le cambian la
  // cantidad o la nota, esta lista deja de coincidir.
  const huellaDeLineas = (
    db
      .prepare(
        `select id, eventId, coalesce(productId,'') p, coalesce(customName,'') c, qty, coalesce(note,'') n
         from "OrderLine" order by id`
      )
      .all() as Record<string, unknown>[]
  ).map((r) => [r.id, r.eventId, r.p, r.c, r.qty, r.n].join("|"));

  db.close();
  return { totales, periodos, eventos, lineasPorEvento, unidadesPorEvento, huellaDeLineas };
}

function comparar(a: Foto, b: Foto): number {
  let mal = 0;
  const ok = (c: boolean, t: string, extra = "") => {
    if (!c) mal++;
    console.log((c ? "  OK   " : "!!!!!  ") + t + (extra ? "  -> " + extra : ""));
  };

  console.log("=== Totales ===");
  for (const k of Object.keys(a.totales)) {
    const x = a.totales[k];
    const y = b.totales[k];
    ok(x === y, `${k}: ${x} -> ${y}`);
  }

  console.log("");
  console.log("=== Los pedidos, renglón por renglón ===");
  ok(
    a.huellaDeLineas.length === b.huellaDeLineas.length,
    `cantidad de renglones: ${a.huellaDeLineas.length} -> ${b.huellaDeLineas.length}`
  );
  const soloAntes = a.huellaDeLineas.filter((h) => !b.huellaDeLineas.includes(h));
  const soloDespues = b.huellaDeLineas.filter((h) => !a.huellaDeLineas.includes(h));
  ok(soloAntes.length === 0, "ningún renglón se perdió ni cambió", soloAntes.slice(0, 3).join(" / "));
  ok(soloDespues.length === 0, "ningún renglón apareció de la nada", soloDespues.slice(0, 3).join(" / "));

  console.log("");
  console.log("=== Períodos ===");
  ok(a.periodos.length === b.periodos.length, "misma cantidad");
  for (const p of a.periodos) {
    const q = b.periodos.find((x) => x.id === p.id);
    ok(Boolean(q), `el período ${p.id.slice(0, 8)}… conserva su identificador`);
    if (!q) continue;
    ok(p.desde === q.desde && p.hasta === q.hasta, `  y sus fechas: ${p.desde} a ${p.hasta}`, `${q.desde} a ${q.hasta}`);
    ok(p.borrado === q.borrado, `  y su estado en la papelera: ${p.borrado ? "borrado" : "activo"}`);
    console.log(`         nombre: ${JSON.stringify(p.label)} -> ${JSON.stringify(q.label)}`);
  }

  console.log("");
  console.log("=== Eventos ===");
  for (const e of a.eventos) {
    const f = b.eventos.find((x) => x.id === e.id);
    ok(Boolean(f), `${e.lugar} conserva su identificador`);
    if (!f) continue;
    ok(e.periodo === f.periodo, `  sigue colgando del mismo período`);
    ok(e.dia === f.dia && e.hora === f.hora, `  mismo día y hora: ${e.dia} ${e.hora}`, `${f.dia} ${f.hora}`);
    ok(
      a.lineasPorEvento[e.id] === b.lineasPorEvento[e.id] &&
        a.unidadesPorEvento[e.id] === b.unidadesPorEvento[e.id],
      `  mismo pedido: ${a.lineasPorEvento[e.id] ?? 0} renglones, ${a.unidadesPorEvento[e.id] ?? 0} unidades`
    );
  }

  console.log("");
  console.log(mal === 0 ? "MIGRACIÓN LIMPIA: no se perdió, duplicó ni reasignó nada." : `${mal} PROBLEMAS`);
  return mal;
}

const [modo, a, b] = process.argv.slice(2);
if (modo === "antes" || modo === "despues") {
  process.stdout.write(JSON.stringify(foto(a, modo), null, 2));
} else if (modo === "comparar") {
  const mal = comparar(JSON.parse(fs.readFileSync(a, "utf8")), JSON.parse(fs.readFileSync(b, "utf8")));
  process.exit(mal === 0 ? 0 : 1);
} else {
  console.error("uso: antes|despues <base.db>  |  comparar <antes.json> <despues.json>");
  process.exit(2);
}
