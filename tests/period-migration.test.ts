import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { aLocal, diaDe, fmtRangoDias } from "../lib/dates";

/**
 * La migración de fin de semana a período operativo.
 *
 * Esta migración es de una sola vez y sobre datos que ya existen: los 276
 * renglones de pedido que hay cargados no se pueden volver a escribir a mano.
 * Por eso no alcanza con que "corra sin error": hay que comprobar que lo que
 * había antes sigue estando después, con los mismos identificadores, la misma
 * cantidad de unidades y la misma hora de pared.
 *
 * La prueba arma una base con el ESQUEMA VIEJO usando SQL crudo (no se puede
 * usar Prisma: el cliente ya solo conoce el modelo nuevo), la carga con datos
 * calcados de los reales, y le aplica el archivo de migración tal cual está en
 * el disco. Si alguien edita ese archivo y rompe algo, esto lo frena antes de
 * que toque la base de producción.
 *
 * Se toman controles ANTES (lo que había) y se comparan contra DESPUÉS.
 */

const DB = path.join(os.tmpdir(), `didier-test-migracion-${process.pid}.db`);
const MIGRACION = path.join(
  __dirname,
  "..",
  "prisma",
  "migrations",
  "20260812120000_periodos_operativos",
  "migration.sql"
);

/**
 * El esquema tal como estaba el día anterior a la migración: `Weekend`,
 * `Event.weekendId`, y los renglones de pedido colgando del evento.
 * Copiado de las migraciones previas, no reescrito de memoria.
 */
const ESQUEMA_VIEJO = `
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rubro" TEXT,
    "type" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'Unidad',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Weekend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME
);
CREATE INDEX "Weekend_deletedAt_idx" ON "Weekend"("deletedAt");

CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weekendId" TEXT NOT NULL,
    "lugar" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "guests" INTEGER NOT NULL DEFAULT 0,
    "responsable" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NO_LISTO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    CONSTRAINT "Event_weekendId_fkey" FOREIGN KEY ("weekendId") REFERENCES "Weekend" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Event_weekendId_deletedAt_idx" ON "Event"("weekendId", "deletedAt");

CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "productId" TEXT,
    "customName" TEXT,
    "customUnit" TEXT,
    "customCategory" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    CONSTRAINT "OrderLine_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrderLine_eventId_productId_key" ON "OrderLine"("eventId", "productId");

CREATE TABLE "WeekendSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weekendId" TEXT NOT NULL,
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" TEXT NOT NULL,
    CONSTRAINT "WeekendSnapshot_weekendId_fkey" FOREIGN KEY ("weekendId") REFERENCES "Weekend" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WeekendSnapshot_weekendId_key" ON "WeekendSnapshot"("weekendId");

CREATE TABLE "WeekendVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weekendId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" DATETIME,
    CONSTRAINT "WeekendVersion_weekendId_fkey" FOREIGN KEY ("weekendId") REFERENCES "Weekend" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WeekendVersion_weekendId_createdAt_idx" ON "WeekendVersion"("weekendId", "createdAt");
`;

/**
 * Cómo escribía las fechas la app vieja: texto ISO con `+00:00` al final.
 * Está copiado de la base de desarrollo real, no inventado.
 */
const utc = (s: string) => `${s}+00:00`;

/** Los días de calendario se guardaban como medianoche UTC. */
const medianoche = (dia: string) => utc(`${dia}T00:00:00.000`);

type Fila = Record<string, unknown>;

let db: InstanceType<typeof Database>;
/** Control ANTES: todo lo que tiene que sobrevivir. */
let antes: {
  periodos: Fila[];
  eventos: Fila[];
  renglones: Fila[];
  unidades: number;
  fechaDeEvento: Map<string, string>;
};

before(() => {
  fs.rmSync(DB, { force: true });
  db = new Database(DB);
  // Producción corre con las claves foráneas prendidas (así las deja Prisma).
  // Si la prueba corriera con ellas apagadas, el DROP TABLE "Event" de la
  // migración parecería inofensivo aunque no lo fuera.
  db.pragma("foreign_keys = ON");
  db.exec(ESQUEMA_VIEJO);

  const ins = (sql: string, filas: unknown[][]) => {
    const st = db.prepare(sql);
    for (const f of filas) st.run(...f);
  };

  ins("INSERT INTO Product (id,name,category,type,unit,stock) VALUES (?,?,?,?,?,?)", [
    ["prod-copa", "Copa de agua", "Vajilla", "REUTILIZABLE", "Unidad", 500],
    ["prod-mantel", "Mantel blanco", "Mantelería", "REUTILIZABLE", "Unidad", 80],
    ["prod-fernet", "Fernet", "Bebida", "CONSUMIBLE", "Botella", 0],
  ]);

  ins(
    "INSERT INTO Weekend (id,label,startDate,endDate,createdAt,deletedAt) VALUES (?,?,?,?,?,?)",
    [
      // Un fin de semana común, con el nombre derivado del rango.
      [
        "per-finde",
        "15 al 16 ago",
        medianoche("2026-08-15"),
        medianoche("2026-08-16"),
        utc("2026-08-10T12:09:45.730"),
        null,
      ],
      // Un solo día: el caso que rompía cuando el finde tenía que durar dos.
      [
        "per-martes",
        "18 al 18 ago",
        medianoche("2026-08-18"),
        medianoche("2026-08-18"),
        utc("2026-08-11T09:00:00.000"),
        null,
      ],
      // Cruce de mes: el nombre derivado se escribe distinto y también hay que vaciarlo.
      [
        "per-cruce",
        "31 ago al 1 sep",
        medianoche("2026-08-31"),
        medianoche("2026-09-01"),
        utc("2026-08-11T10:00:00.000"),
        null,
      ],
      // En la papelera, y con un nombre puesto a mano que hay que respetar.
      [
        "per-puerto",
        "puerto",
        medianoche("2026-12-08"),
        medianoche("2026-12-09"),
        utc("2026-08-05T12:57:56.183"),
        utc("2026-08-10T12:09:07.492"),
      ],
    ]
  );

  ins(
    "INSERT INTO Event (id,weekendId,lugar,date,guests,responsable,status,createdAt,deletedAt) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      // Un evento de noche: el caso corriente.
      [
        "ev-noche",
        "per-finde",
        "El Carmen Center",
        utc("2026-08-15T21:00:00.000"),
        110,
        "pablo",
        "LISTO",
        utc("2026-08-10T12:11:07.587"),
        null,
      ],
      // Las 00:30: acá el corrimiento cambia de día si tiene el signo al revés.
      [
        "ev-trasnoche",
        "per-finde",
        "Salón Los Álamos",
        utc("2026-08-16T00:30:00.000"),
        60,
        null,
        "NO_LISTO",
        utc("2026-08-10T12:20:00.000"),
        null,
      ],
      // Mediodía de un martes, en un período de un solo día.
      [
        "ev-martes",
        "per-martes",
        "Sociedad Rural",
        utc("2026-08-18T12:00:00.000"),
        200,
        "lisi",
        "NO_LISTO",
        utc("2026-08-11T09:05:00.000"),
        null,
      ],
      // Un evento en la papelera dentro de un período en la papelera.
      [
        "ev-puerto",
        "per-puerto",
        "puerto",
        utc("2026-12-08T16:00:00.000"),
        150,
        "lisi chiste",
        "LISTO",
        utc("2026-08-05T12:59:15.355"),
        utc("2026-08-10T12:09:04.259"),
      ],
    ]
  );

  ins(
    "INSERT INTO OrderLine (id,eventId,productId,customName,customUnit,customCategory,qty,note) VALUES (?,?,?,?,?,?,?,?)",
    [
      ["ren-1", "ev-noche", "prod-copa", null, null, null, 120, "que vayan 10 de más"],
      ["ren-2", "ev-noche", "prod-mantel", null, null, null, 12, null],
      // Un producto suelto, cargado a mano, sin entrada en el catálogo.
      ["ren-3", "ev-noche", null, "Servilletas de tela", "Unidad", "Mantelería", 130, "beige"],
      // Cantidad cero: se guarda igual y tiene que seguir estando después.
      ["ren-4", "ev-trasnoche", "prod-copa", null, null, null, 0, null],
      ["ren-5", "ev-trasnoche", "prod-fernet", null, null, null, 8, "sin hielo"],
      ["ren-6", "ev-martes", "prod-copa", null, null, null, 220, null],
      // Del evento en la papelera: tampoco se toca.
      ["ren-7", "ev-puerto", "prod-mantel", null, null, null, 20, "los del depósito chico"],
    ]
  );

  ins("INSERT INTO WeekendSnapshot (id,weekendId,takenAt,data) VALUES (?,?,?,?)", [
    ["snap-1", "per-finde", utc("2026-08-10T13:00:00.000"), '{"copas":120}'],
  ]);

  ins(
    "INSERT INTO WeekendVersion (id,weekendId,kind,data,lineCount,actorId,actorName,createdAt,restoredAt) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      ["ver-1", "per-finde", "AUTO", '{"v":1}', 3, "u-1", "Ana", utc("2026-08-10T13:05:00.000"), null],
      [
        "ver-2",
        "per-puerto",
        "MANUAL",
        '{"v":2}',
        1,
        null,
        "Enrique",
        utc("2026-08-10T13:06:00.000"),
        utc("2026-08-10T14:00:00.000"),
      ],
    ]
  );

  // --- Control ANTES -------------------------------------------------------
  const eventos = db.prepare("SELECT * FROM Event ORDER BY id").all() as Fila[];
  antes = {
    periodos: db.prepare("SELECT * FROM Weekend ORDER BY id").all() as Fila[],
    eventos,
    renglones: db
      .prepare(
        "SELECT id, eventId, productId, customName, qty, note FROM OrderLine ORDER BY id"
      )
      .all() as Fila[],
    unidades: (db.prepare("SELECT COALESCE(SUM(qty),0) AS t FROM OrderLine").get() as { t: number })
      .t,
    fechaDeEvento: new Map(eventos.map((e) => [String(e.id), String(e.date)])),
  };

  // --- La migración, tal cual está en el disco -----------------------------
  db.exec(fs.readFileSync(MIGRACION, "utf8"));
});

after(() => {
  try {
    db?.close();
  } catch {
    /* ya estaba cerrada */
  }
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`, `${DB}-journal`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* en Windows el archivo puede quedar tomado; se lo lleva el sistema */
    }
  }
});

/** Atajos de lectura sobre la base ya migrada. */
const todos = (sql: string) => db.prepare(sql).all() as Fila[];
const uno = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as Fila | undefined;

// ---------------------------------------------------------------------------
// Control ANTES: que el punto de partida sea el que la prueba dice que es
// ---------------------------------------------------------------------------

test("el punto de partida tiene datos: sin esto, todo lo demás compara vacío contra vacío", () => {
  // Si la carga del esquema viejo fallara en silencio, las comparaciones de
  // abajo pasarían con listas vacías y la migración quedaría sin probar.
  assert.equal(antes.periodos.length, 4);
  assert.equal(antes.eventos.length, 4);
  assert.equal(antes.renglones.length, 7);
  assert.equal(antes.unidades, 510);
  assert.equal(antes.periodos.every((p) => typeof p.startDate === "string"), true);
});

// ---------------------------------------------------------------------------
// Lo que no se puede perder
// ---------------------------------------------------------------------------

test("los identificadores de períodos y eventos son los mismos, y cada evento sigue colgando del suyo", () => {
  // Los identificadores son lo que mantiene vivos los vínculos: renglones,
  // avisos, versiones y los enlaces que la gente tiene guardados en el celular.
  const periodos = todos('SELECT id FROM "OperationalPeriod" ORDER BY id');
  assert.deepEqual(
    periodos.map((p) => p.id),
    antes.periodos.map((p) => p.id)
  );

  const eventos = todos('SELECT id, periodId FROM "Event" ORDER BY id');
  assert.deepEqual(
    eventos.map((e) => e.id),
    antes.eventos.map((e) => e.id)
  );
  // Y cada uno quedó bajo el mismo período que tenía como finde.
  const esperado = new Map(antes.eventos.map((e) => [String(e.id), String(e.weekendId)]));
  for (const e of eventos) {
    assert.equal(e.periodId, esperado.get(String(e.id)), `el evento ${e.id} cambió de período`);
  }
});

test("los renglones de pedido quedan idénticos, uno por uno, y la suma de unidades no cambia", () => {
  // Este es el dato caro: son cargas a mano que nadie va a rehacer. La
  // migración renombra tablas alrededor de OrderLine, así que lo que se
  // controla es que no la haya rozado.
  const despues = todos(
    'SELECT id, eventId, productId, customName, qty, note FROM "OrderLine" ORDER BY id'
  );
  assert.deepEqual(despues, antes.renglones);

  const suma = (uno('SELECT COALESCE(SUM(qty),0) AS t FROM "OrderLine"') as { t: number }).t;
  assert.equal(suma, antes.unidades);

  // Y ninguno quedó apuntando a un evento que ya no existe.
  const huerfanos = todos(
    'SELECT l.id FROM "OrderLine" l LEFT JOIN "Event" e ON e.id = l.eventId WHERE e.id IS NULL'
  );
  assert.deepEqual(huerfanos, []);
});

test("el estado de la papelera se conserva en períodos y eventos", () => {
  const puerto = uno('SELECT deletedAt FROM "OperationalPeriod" WHERE id = ?', "per-puerto");
  assert.equal(puerto?.deletedAt, "2026-08-10T12:09:07.492+00:00");
  const vivo = uno('SELECT deletedAt FROM "OperationalPeriod" WHERE id = ?', "per-finde");
  assert.equal(vivo?.deletedAt, null);

  const evBorrado = uno('SELECT deletedAt FROM "Event" WHERE id = ?', "ev-puerto");
  assert.equal(evBorrado?.deletedAt, "2026-08-10T12:09:04.259+00:00");
  const evVivo = uno('SELECT deletedAt FROM "Event" WHERE id = ?', "ev-noche");
  assert.equal(evVivo?.deletedAt, null);
});

// ---------------------------------------------------------------------------
// Las dos conversiones
// ---------------------------------------------------------------------------

test("los límites del período pasan de medianoche UTC al día de calendario que decían", () => {
  // El motivo de todo el cambio: un período "hasta el 16" guardado como
  // instante se leía "hasta el 15" en una máquina en UTC−3. Como texto, no hay
  // zona horaria que pueda correrlo.
  const filas = todos('SELECT id, startDay, endDay FROM "OperationalPeriod" ORDER BY id');
  assert.deepEqual(filas, [
    { id: "per-cruce", startDay: "2026-08-31", endDay: "2026-09-01" },
    { id: "per-finde", startDay: "2026-08-15", endDay: "2026-08-16" },
    { id: "per-martes", startDay: "2026-08-18", endDay: "2026-08-18" },
    { id: "per-puerto", startDay: "2026-12-08", endDay: "2026-12-09" },
  ]);
});

test("cada evento se sigue leyendo a la misma hora de pared, ahora en hora argentina", () => {
  // Antes la hora de pared estaba escrita como si UTC fuera la hora local: un
  // evento "a las 21" decía 21:00 UTC. De ahora en más se lee en Argentina, así
  // que el instante tiene que correrse +3 para que la persona siga viendo 21.
  for (const [id, viejo] of antes.fechaDeEvento) {
    const nuevo = uno('SELECT date FROM "Event" WHERE id = ?', id);
    const paredAntes = viejo.slice(0, 16); // "AAAA-MM-DDTHH:MM" que se leía en UTC
    const paredAhora = aLocal(new Date(String(nuevo?.date))); // lo que se lee en Argentina
    assert.equal(paredAhora, paredAntes, `el evento ${id} cambió de hora de pared`);
  }
});

test("el evento de las 00:30 no se corre de día: es el que delata el signo al revés", () => {
  // A las 21 un corrimiento equivocado se nota en la hora pero no en el día.
  // A las 00:30 se nota en los dos, y el evento se iría del período.
  const trasnoche = uno('SELECT date FROM "Event" WHERE id = ?', "ev-trasnoche");
  const instante = new Date(String(trasnoche?.date));
  assert.equal(diaDe(instante), "2026-08-16");
  assert.equal(aLocal(instante), "2026-08-16T00:30");

  // Y sigue cayendo dentro del rango de su período, que es lo que importa.
  const p = uno('SELECT startDay, endDay FROM "OperationalPeriod" WHERE id = ?', "per-finde");
  assert.ok(diaDe(instante) >= String(p?.startDay) && diaDe(instante) <= String(p?.endDay));

  // El de las 21 sigue siendo del 15, no del 16.
  const noche = uno('SELECT date FROM "Event" WHERE id = ?', "ev-noche");
  assert.equal(diaDe(new Date(String(noche?.date))), "2026-08-15");
});

// ---------------------------------------------------------------------------
// El nombre
// ---------------------------------------------------------------------------

test("el nombre que solo repetía el rango se vacía; el puesto a mano se conserva", () => {
  // Un nombre derivado de las fechas es lo primero que queda desactualizado
  // cuando alguien mueve el período. Vacío significa "mostrá el rango".
  const nombres = Object.fromEntries(
    todos('SELECT id, label FROM "OperationalPeriod"').map((p) => [p.id, p.label])
  );
  assert.equal(nombres["per-finde"], null, '"15 al 16 ago" era el rango, no un nombre');
  assert.equal(nombres["per-martes"], null, '"18 al 18 ago" era el rango, no un nombre');
  assert.equal(nombres["per-cruce"], null, '"31 ago al 1 sep" era el rango, no un nombre');
  assert.equal(nombres["per-puerto"], "puerto", "el nombre puesto a mano tiene que quedar");
});

test("un rango que cruza de año también se reconoce como nombre derivado y se vacía", () => {
  // ESTADO ACTUAL DEL CÓDIGO, no lo deseable. La migración arma el nombre
  // derivado en dos formas —"15 al 16 ago" y "31 ago al 1 sep"— pero nunca con
  // el año, y `fmtRangoDias` sí lo pone cuando el rango cruza de año
  // ("31 dic 2026 al 1 ene 2027"). Un período de Año Nuevo se queda entonces
  // con un nombre que repite las fechas y que no las va a seguir si se editan.
  // Se prueba sobre una base aparte para no ensuciar la de las otras pruebas.
  const aparte = path.join(os.tmpdir(), `didier-test-migracion-anio-${process.pid}.db`);
  fs.rmSync(aparte, { force: true });
  const d2 = new Database(aparte);
  try {
    d2.pragma("foreign_keys = ON");
    d2.exec(ESQUEMA_VIEJO);
    const st = d2.prepare("INSERT INTO Weekend (id,label,startDate,endDate) VALUES (?,?,?,?)");
    st.run("anio-con", "31 dic 2026 al 1 ene 2027", medianoche("2026-12-31"), medianoche("2027-01-01"));
    st.run("anio-sin", "31 dic al 1 ene", medianoche("2026-12-31"), medianoche("2027-01-01"));
    d2.exec(fs.readFileSync(MIGRACION, "utf8"));
    const r = Object.fromEntries(
      (d2.prepare('SELECT id, label FROM "OperationalPeriod"').all() as Fila[]).map((p) => [
        p.id,
        p.label,
      ])
    );
    // Las tres formas que arma fmtRangoDias se reconocen como derivadas y se
    // vacían, incluida la de Año Nuevo, que lleva el año adentro.
    assert.equal(r["anio-con"], null, "el rango con año quedó escrito en vez de vaciarse");
    assert.equal(r["anio-sin"], null);
  } finally {
    try {
      d2.close();
      fs.rmSync(aparte, { force: true });
    } catch {
      /* en Windows el archivo puede quedar tomado */
    }
  }
});

test("el período que se quedó sin nombre se muestra por su rango y se lee igual que antes", () => {
  // Vaciar el nombre solo sirve si la pantalla sabe qué poner en su lugar.
  const p = uno('SELECT label, startDay, endDay FROM "OperationalPeriod" WHERE id = ?', "per-finde");
  assert.equal(p?.label, null);
  assert.equal(fmtRangoDias(String(p?.startDay), String(p?.endDay)), "15 al 16 ago");

  // El de un solo día ya no se dice "18 al 18": se dice entero.
  const m = uno(
    'SELECT startDay, endDay FROM "OperationalPeriod" WHERE id = ?',
    "per-martes"
  );
  assert.equal(fmtRangoDias(String(m?.startDay), String(m?.endDay)), "Mar 18 ago");
});

// ---------------------------------------------------------------------------
// El resto del arrastre
// ---------------------------------------------------------------------------

test("resguardos y versiones conservan su id y pasan a colgar del período", () => {
  const snaps = todos('SELECT id, periodId, takenAt, data FROM "PeriodSnapshot" ORDER BY id');
  assert.deepEqual(snaps, [
    { id: "snap-1", periodId: "per-finde", takenAt: "2026-08-10T13:00:00.000+00:00", data: '{"copas":120}' },
  ]);

  const vers = todos(
    'SELECT id, periodId, kind, lineCount, actorName, restoredAt FROM "PeriodVersion" ORDER BY id'
  );
  assert.deepEqual(vers, [
    { id: "ver-1", periodId: "per-finde", kind: "AUTO", lineCount: 3, actorName: "Ana", restoredAt: null },
    {
      id: "ver-2",
      periodId: "per-puerto",
      kind: "MANUAL",
      lineCount: 1,
      actorName: "Enrique",
      restoredAt: "2026-08-10T14:00:00.000+00:00",
    },
  ]);
});

test("no queda ninguna tabla vieja ni ningún vínculo roto detrás", () => {
  // Una migración a medio aplicar es peor que una que falla: la app lee el
  // modelo nuevo mientras los datos siguen en el viejo.
  const tablas = todos("SELECT name FROM sqlite_master WHERE type='table'").map((t) => t.name);
  for (const vieja of ["Weekend", "WeekendSnapshot", "WeekendVersion", "new_Event"]) {
    assert.equal(tablas.includes(vieja), false, `quedó la tabla ${vieja}`);
  }
  for (const nueva of ["OperationalPeriod", "PeriodSnapshot", "PeriodVersion", "Event", "OrderLine"]) {
    assert.equal(tablas.includes(nueva), true, `falta la tabla ${nueva}`);
  }

  // El evento ya no tiene por dónde volver al finde.
  const columnas = (db.pragma('table_info("Event")') as { name: string }[]).map((c) => c.name);
  assert.equal(columnas.includes("weekendId"), false);
  assert.equal(columnas.includes("periodId"), true);

  // Y la base queda referencialmente sana con las claves foráneas prendidas.
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  assert.equal((db.pragma("foreign_keys", { simple: true }) as number) === 1, true);
});
