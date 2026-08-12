import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  ZONA,
  aLocal,
  diaDe,
  diaSemana,
  diasEntre,
  esDia,
  fmtDia,
  fmtEvento,
  fmtRangoDias,
  hoy,
  instanteDe,
  instanteDeLocal,
  partesDe,
  partirLocal,
  sumarDias,
} from "../lib/dates";
import { cubreInstante, nombreDe } from "../lib/period-fit";

/**
 * La política de fechas y los límites de un período operativo.
 *
 * Lo que se protege acá es una sola promesa: **el calendario es el de
 * Argentina, corra donde corra el proceso**. La app se desarrolla en máquinas en
 * UTC−3 y se despliega en un servidor en UTC; el día de un evento se tiene que
 * responder igual en las dos. Cuando eso no se cumplía, un evento de las 21 del
 * último día del período (que en UTC ya es el día siguiente) se caía afuera del
 * período y su vajilla se contaba contra el stock equivocado.
 *
 * Por eso hay dos clases de prueba en este archivo:
 *
 *  1. Las que corren acá y comprueban la regla (extremos del período, ida y
 *     vuelta del formulario, aritmética de calendario, cómo se escribe un rango).
 *  2. Una que **relanza el módulo en otras zonas horarias**. Node lee la zona al
 *     arrancar, así que tocar `process.env.TZ` desde adentro no cambia nada: hay
 *     que lanzar procesos hijos con `TZ` distinto y comparar las respuestas.
 *     Esa es la prueba central del archivo.
 */

// ---------------------------------------------------------------------------
// 1. La zona horaria del proceso no puede cambiar ninguna respuesta
// ---------------------------------------------------------------------------

/** Zonas elegidas para que ninguna coincida con Argentina y se cubran los dos
 *  lados del meridiano: +14 (Kiritimati) y −7 (Los Ángeles) son los extremos
 *  donde un "día" se corre entero. */
const ZONAS_DE_PRUEBA = ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati"];

/** Instantes con hora, elegidos por los bordes: medianoche, un minuto antes de
 *  medianoche, y las 21 del último día (que en UTC ya es el día siguiente). */
const INSTANTES = [
  "2026-08-15T03:00:00.000Z", // 00:00 del sábado 15 en Argentina
  "2026-08-15T02:59:00.000Z", // 23:59 del viernes 14
  "2026-08-17T02:59:00.000Z", // 23:59 del domingo 16
  "2026-08-17T03:00:00.000Z", // 00:00 del lunes 17
  "2026-08-17T00:00:00.000Z", // 21:00 del domingo 16 — el caso que rompía todo
  "2027-01-01T02:00:00.000Z", // 23:00 del 31/12/2026: en UTC ya es 2027
];

const HORAS: [string, string][] = [
  ["2026-08-15", "00:00"],
  ["2026-08-16", "21:00"],
  ["2026-08-16", "23:59"],
  ["2026-12-31", "23:30"],
  ["2024-02-29", "12:00"],
];

const LOCALES = [
  "2026-08-15T00:00",
  "2026-08-16T21:00",
  "2026-12-31T23:59",
  "2027-01-01T00:00",
  "2024-02-29T00:00",
  "2026-06-30T12:34",
];

const RANGOS: [string, string][] = [
  ["2026-08-18", "2026-08-18"],
  ["2026-08-15", "2026-08-16"],
  ["2026-08-30", "2026-09-01"],
  ["2026-12-30", "2027-01-02"],
];

const DIAS_SUELTOS = ["2026-08-15", "2026-08-16", "2026-12-31", "2024-02-29"];

/**
 * El "ahora" que se le hace creer a la sonda: 21:30 del domingo 16 en Argentina.
 *
 * Está elegido dentro de la franja de las tres horas en las que Argentina y UTC
 * no están en el mismo día. Sin fijar el reloj, `hoy()` solo se podría comprobar
 * contra el día real, y una versión de `hoy()` escrita en UTC daría bien 21 de
 * cada 24 horas: la prueba pasaría casi siempre y fallaría de noche, sola, sin
 * que nadie hubiera tocado nada.
 */
const AHORA_FIJO = "2026-08-17T00:30:00.000Z";
const HOY_ESPERADO = "2026-08-16";

/**
 * Las respuestas correctas, escritas a mano según el calendario argentino.
 *
 * Van a mano y no calculadas con el propio módulo a propósito: si se comparara
 * el módulo contra sí mismo, un error de −1 día pasaría desapercibido mientras
 * fuera parejo en las cuatro zonas.
 */
const ESPERADO = {
  dias: ["2026-08-15", "2026-08-14", "2026-08-16", "2026-08-17", "2026-08-16", "2026-12-31"],
  locales: [
    "2026-08-15T00:00",
    "2026-08-14T23:59",
    "2026-08-16T23:59",
    "2026-08-17T00:00",
    "2026-08-16T21:00",
    "2026-12-31T23:00",
  ],
  eventos: [
    "Sáb 15/8 · 0hs",
    "Vie 14/8 · 23:59",
    "Dom 16/8 · 23:59",
    "Lun 17/8 · 0hs",
    "Dom 16/8 · 21hs",
    "Jue 31/12 · 23hs",
  ],
  momentos: ["15/8 · 00:00", "14/8 · 23:59", "16/8 · 23:59", "17/8 · 00:00", "16/8 · 21:00", "31/12 · 23:00"],
  instantes: [
    "2026-08-15T03:00:00.000Z",
    "2026-08-17T00:00:00.000Z",
    "2026-08-17T02:59:00.000Z",
    "2027-01-01T02:30:00.000Z",
    "2024-02-29T15:00:00.000Z",
  ],
  idaYVuelta: LOCALES,
  rangos: ["Mar 18 ago", "15 al 16 ago", "30 ago al 1 sep", "30 dic 2026 al 2 ene 2027"],
  semana: [6, 0, 4, 4],
  fmtDias: ["Sáb 15/8", "Dom 16/8", "Jue 31/12", "Jue 29/2"],
  suma: ["2026-08-16", "2026-08-17", "2027-01-01", "2024-03-01"],
  entre: 1,
  hoy: HOY_ESPERADO,
};

type Salida = typeof ESPERADO & { zona: string; desfasaje: number; relojCongelado: string };

const RAIZ = path.resolve(__dirname, "..");
const SONDA = path.join(os.tmpdir(), `didier-sonda-zonas-${process.pid}.mts`);
const corridas: Record<string, Salida> = {};

/** El programita que se relanza en cada zona. Importa el módulo real por ruta
 *  absoluta y escupe todas las respuestas en JSON. */
function fuenteDeLaSonda(): string {
  const url = pathToFileURL(path.join(RAIZ, "lib", "dates.ts")).href;
  return [
    // El reloj se congela ANTES de importar el módulo: así `hoy()` tiene una
    // respuesta correcta única y comprobable, en vez de depender del día real.
    `const RELOJ: any = Date;`,
    `const FIJO = RELOJ.parse(${JSON.stringify(AHORA_FIJO)});`,
    `class DateFija extends (RELOJ as any) {`,
    `  constructor(...args: any[]) { if (args.length === 0) { super(FIJO); } else { super(...args); } }`,
    `  static now() { return FIJO; }`,
    `}`,
    `globalThis.Date = DateFija as any;`,
    `const d: any = await import(${JSON.stringify(url)});`,
    `const INSTANTES = ${JSON.stringify(INSTANTES)};`,
    `const HORAS = ${JSON.stringify(HORAS)};`,
    `const LOCALES = ${JSON.stringify(LOCALES)};`,
    `const RANGOS = ${JSON.stringify(RANGOS)};`,
    `const DIAS = ${JSON.stringify(DIAS_SUELTOS)};`,
    `process.stdout.write(JSON.stringify({`,
    `  zona: Intl.DateTimeFormat().resolvedOptions().timeZone,`,
    `  desfasaje: new Date("2026-08-16T12:00:00.000Z").getTimezoneOffset(),`,
    `  dias: INSTANTES.map((i: string) => d.diaDe(new Date(i))),`,
    `  locales: INSTANTES.map((i: string) => d.aLocal(new Date(i))),`,
    `  eventos: INSTANTES.map((i: string) => d.fmtEvento(new Date(i))),`,
    `  momentos: INSTANTES.map((i: string) => d.fmtMomento(new Date(i))),`,
    `  instantes: HORAS.map((h: string[]) => d.instanteDe(h[0], h[1]).toISOString()),`,
    `  idaYVuelta: LOCALES.map((v: string) => d.aLocal(d.instanteDeLocal(v))),`,
    `  rangos: RANGOS.map((r: string[]) => d.fmtRangoDias(r[0], r[1])),`,
    `  semana: DIAS.map((x: string) => d.diaSemana(x)),`,
    `  fmtDias: DIAS.map((x: string) => d.fmtDia(x)),`,
    `  suma: DIAS.map((x: string) => d.sumarDias(x, 1)),`,
    `  entre: d.diasEntre("2026-12-31", "2027-01-01"),`,
    `  hoy: d.hoy(),`,
    `  relojCongelado: new Date().toISOString(),`,
    `}));`,
    ``,
  ].join("\n");
}

before(() => {
  // .mts para que el hijo corra como módulo y admita el import dinámico arriba
  // de todo; la carpeta temporal no tiene package.json que lo declare.
  fs.writeFileSync(SONDA, fuenteDeLaSonda(), "utf8");
  for (const tz of ZONAS_DE_PRUEBA) {
    const salida = execFileSync(process.execPath, ["--import", "tsx", SONDA], {
      // cwd en la raíz para que el hijo encuentre `tsx` del proyecto.
      cwd: RAIZ,
      env: { ...process.env, TZ: tz },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    corridas[tz] = JSON.parse(salida) as Salida;
  }
});

after(() => {
  try {
    fs.rmSync(SONDA, { force: true });
  } catch {
    /* en Windows el archivo puede quedar tomado; se lo lleva el sistema */
  }
});

test("las zonas de prueba realmente tomaron efecto: si no, lo de abajo no prueba nada", () => {
  const zonas = ZONAS_DE_PRUEBA.map((tz) => corridas[tz].zona);
  const desfasajes = ZONAS_DE_PRUEBA.map((tz) => corridas[tz].desfasaje);
  assert.equal(
    new Set(desfasajes).size,
    ZONAS_DE_PRUEBA.length,
    `los procesos hijos no cambiaron de zona (${zonas.join(", ")} / ${desfasajes.join(", ")}): ` +
      "sin esto, la prueba de zonas es decorativa"
  );
  // Ninguna de las cuatro es Argentina: si el módulo se apoyara en la zona del
  // proceso, las cuatro tendrían que dar mal.
  for (const tz of ZONAS_DE_PRUEBA) {
    assert.notEqual(corridas[tz].desfasaje, 180, `${tz} quedó en hora argentina`);
  }
});

test("el día argentino de un evento es el mismo en UTC, Tokio, Los Ángeles y Kiritimati", () => {
  for (const tz of ZONAS_DE_PRUEBA) {
    assert.deepEqual(corridas[tz].dias, ESPERADO.dias, `los días salieron distintos corriendo en ${tz}`);
  }
});

test("todo el resto de la política de fechas tampoco depende de la zona del proceso", () => {
  for (const tz of ZONAS_DE_PRUEBA) {
    const c = corridas[tz];
    for (const clave of Object.keys(ESPERADO) as (keyof typeof ESPERADO)[]) {
      assert.deepEqual(c[clave], ESPERADO[clave], `${String(clave)} salió distinto corriendo en ${tz}`);
    }
  }
});

test("las cuatro corridas son idénticas entre sí, campo por campo", () => {
  // Comparación cruzada además de la comparación contra lo esperado: si mañana
  // se agrega un campo a la sonda y se olvida el valor esperado, esta igual
  // atrapa la diferencia entre zonas.
  const sinZona = (s: Salida) => {
    const copia: Record<string, unknown> = { ...s };
    delete copia.zona;
    delete copia.desfasaje;
    return copia;
  };
  const primera = sinZona(corridas[ZONAS_DE_PRUEBA[0]]);
  for (const tz of ZONAS_DE_PRUEBA.slice(1)) {
    assert.deepEqual(sinZona(corridas[tz]), primera, `${tz} no coincide con ${ZONAS_DE_PRUEBA[0]}`);
  }
});

test("la zona declarada es la de Argentina y no la del sistema", () => {
  assert.equal(ZONA, "America/Argentina/Buenos_Aires");
});

test("el reloj de la sonda quedó congelado: si no, lo de 'hoy' no prueba nada", () => {
  for (const tz of ZONAS_DE_PRUEBA) {
    assert.equal(
      corridas[tz].relojCongelado,
      AHORA_FIJO,
      `en ${tz} la sonda no tomó el reloj fijo: 'hoy' estaría mirando el día real`
    );
  }
});

test("'hoy' es el día argentino de este momento, no el de UTC ni el del sistema", () => {
  // A las 21:30 del domingo en Argentina, en UTC ya es lunes. `hoy()` alimenta
  // los valores por defecto de los formularios y la sugerencia de período: si
  // contesta el día de UTC, cada noche a partir de las 21 la app propone el día
  // siguiente y el evento nace en el período equivocado.
  for (const tz of ZONAS_DE_PRUEBA) {
    assert.equal(corridas[tz].hoy, HOY_ESPERADO, `'hoy' salió distinto corriendo en ${tz}`);
  }
  assert.equal(
    new Date(AHORA_FIJO).toISOString().slice(0, 10),
    "2026-08-17",
    "el momento elegido tiene que caer en un día distinto en UTC, o la prueba no distingue nada"
  );
});

test("'hoy' de verdad, contra el reloj real, sigue siendo el día argentino", () => {
  // La de arriba corre con el reloj congelado; esta comprueba lo mismo sin
  // trucos, contra un cálculo independiente del módulo (Argentina es UTC−3 fijo).
  // Se toma el testigo antes y después por si el minuto cambia justo en el medio.
  const oraculo = () => new Date(Date.now() - 180 * 60 * 1000).toISOString().slice(0, 10);
  const antes = oraculo();
  const respuesta = hoy();
  const despues = oraculo();
  assert.ok(
    respuesta === antes || respuesta === despues,
    `hoy() dijo ${respuesta} y el día argentino era ${antes}`
  );
});

// ---------------------------------------------------------------------------
// 1.bis. La defensa contra la medianoche que se cuenta como "las 24"
// ---------------------------------------------------------------------------

/**
 * `partesDe` normaliza la hora con `% 24` porque un formateador puede contestar
 * "24" a la medianoche en vez de "00" (el ciclo horario h24). En este Node,
 * `hour12: false` resuelve a h23 y contesta "00", así que esa línea **nunca se
 * ejecuta con un 24 adelante**: sacarla no cambia ninguna respuesta y ninguna
 * prueba se entera.
 *
 * Eso convierte a la defensa en una promesa sin testigo. El ciclo horario lo
 * elige el motor a partir de la locale y de los datos de ICU, no lo fija esta
 * app: alcanza con un Node compilado con otra ICU, o con que el default de la
 * locale cambie, para que empiece a llegar "24" de verdad. Acá se simula ese
 * motor envolviendo `Intl.DateTimeFormat` antes de importar el módulo, y se
 * exige que la respuesta siga siendo medianoche del día que empieza.
 */
const SONDA_H24 = path.join(os.tmpdir(), `didier-sonda-h24-${process.pid}.mts`);

type SalidaH24 = {
  crudo: string;
  partes: { year: number; month: number; day: number; hour: number; minute: number };
  local: string;
  evento: string;
  momento: string;
  dia: string;
};

let h24: SalidaH24;

before(() => {
  const url = pathToFileURL(path.join(RAIZ, "lib", "dates.ts")).href;
  const fuente = [
    // Se fuerza el ciclo h24 en todo formateador que pida hora en 24 horas:
    // así se ve lo que haría un motor que cuenta la medianoche como "las 24".
    `const REAL: any = Intl.DateTimeFormat;`,
    `function DTF24(this: any, locale: any, opciones: any) {`,
    `  const o = { ...(opciones ?? {}) };`,
    `  if (o.hour !== undefined && o.hour12 === false) { delete o.hour12; o.hourCycle = "h24"; }`,
    `  return new REAL(locale, o);`,
    `}`,
    `(DTF24 as any).supportedLocalesOf = REAL.supportedLocalesOf.bind(REAL);`,
    `(Intl as any).DateTimeFormat = DTF24;`,
    `const d: any = await import(${JSON.stringify(url)});`,
    // Medianoche del domingo 16 en Argentina.
    `const medianoche = d.instanteDe("2026-08-16", "00:00");`,
    `const control = new (Intl as any).DateTimeFormat("en-CA", {`,
    `  timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", hour12: false,`,
    `});`,
    `process.stdout.write(JSON.stringify({`,
    `  crudo: control.format(medianoche),`,
    `  partes: d.partesDe(medianoche),`,
    `  local: d.aLocal(medianoche),`,
    `  evento: d.fmtEvento(medianoche),`,
    `  momento: d.fmtMomento(medianoche),`,
    `  dia: d.diaDe(medianoche),`,
    `}));`,
    ``,
  ].join("\n");
  fs.writeFileSync(SONDA_H24, fuente, "utf8");
  const salida = execFileSync(process.execPath, ["--import", "tsx", SONDA_H24], {
    cwd: RAIZ,
    env: { ...process.env, TZ: "UTC" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  h24 = JSON.parse(salida) as SalidaH24;
});

after(() => {
  try {
    fs.rmSync(SONDA_H24, { force: true });
  } catch {
    /* en Windows el archivo puede quedar tomado; se lo lleva el sistema */
  }
});

test("la sonda simuló de verdad un motor que dice 'las 24': si no, no hay nada que defender", () => {
  assert.equal(h24.crudo, "24", "el formateador de control no devolvió 24; la simulación no tomó efecto");
});

test("con un motor que dice 'las 24', la medianoche sigue siendo las 0 del día que empieza", () => {
  assert.equal(h24.partes.hour, 0, "la hora 24 tiene que normalizarse a 0");
  assert.equal(h24.partes.day, 16, "y sin retroceder al día anterior");
  assert.equal(h24.partes.month, 8);
  assert.equal(h24.partes.year, 2026);
});

test("con un motor que dice 'las 24', el formulario y los carteles no muestran '24:00'", () => {
  assert.equal(h24.local, "2026-08-16T00:00", "un datetime-local con hora 24 es inválido: el campo queda vacío");
  assert.equal(h24.evento, "Dom 16/8 · 0hs");
  assert.equal(h24.momento, "16/8 · 00:00");
  assert.equal(h24.dia, "2026-08-16");
});

// ---------------------------------------------------------------------------
// 2. Los dos extremos de un período
// ---------------------------------------------------------------------------

const PERIODO = { startDay: "2026-08-15", endDay: "2026-08-16" };
const UN_MINUTO = 60 * 1000;

test("el primer minuto del primer día está adentro; el minuto anterior, afuera", () => {
  const arranque = instanteDe("2026-08-15", "00:00");
  assert.equal(diaDe(arranque), "2026-08-15");
  assert.equal(cubreInstante(PERIODO, arranque), true);

  const unMinutoAntes = new Date(arranque.getTime() - UN_MINUTO);
  assert.equal(diaDe(unMinutoAntes), "2026-08-14");
  assert.equal(cubreInstante(PERIODO, unMinutoAntes), false);
});

test("el último minuto del último día está adentro; el minuto siguiente, afuera", () => {
  const cierre = instanteDe("2026-08-16", "23:59");
  assert.equal(diaDe(cierre), "2026-08-16");
  assert.equal(cubreInstante(PERIODO, cierre), true);

  const unMinutoDespues = new Date(cierre.getTime() + UN_MINUTO);
  assert.equal(diaDe(unMinutoDespues), "2026-08-17");
  assert.equal(cubreInstante(PERIODO, unMinutoDespues), false);
});

test("un período de una sola jornada cubre ese día entero y nada más", () => {
  const solo = { startDay: "2026-08-18", endDay: "2026-08-18" };
  assert.equal(cubreInstante(solo, instanteDe("2026-08-18", "00:00")), true);
  assert.equal(cubreInstante(solo, instanteDe("2026-08-18", "23:59")), true);
  assert.equal(cubreInstante(solo, new Date(instanteDe("2026-08-18", "00:00").getTime() - UN_MINUTO)), false);
  assert.equal(cubreInstante(solo, new Date(instanteDe("2026-08-18", "23:59").getTime() + UN_MINUTO)), false);
});

test("el evento de las 21 del último día sigue adentro aunque en UTC ya sea mañana", () => {
  // Este es el bug que motivó todo el cambio de modelo: 21hs de Argentina del
  // domingo 16 es medianoche UTC del lunes 17. Leído con la zona del proceso en
  // el servidor, el evento caía en el 17 y se salía del período.
  const evento = instanteDe("2026-08-16", "21:00");
  assert.equal(evento.toISOString(), "2026-08-17T00:00:00.000Z", "en UTC el instante ya es del día siguiente");
  assert.equal(evento.toISOString().slice(0, 10), "2026-08-17");

  assert.equal(diaDe(evento), "2026-08-16", "pero el día argentino sigue siendo el 16");
  assert.equal(cubreInstante(PERIODO, evento), true);
  assert.equal(fmtEvento(evento), "Dom 16/8 · 21hs");
  assert.equal(partesDe(evento).hour, 21);
});

test("un evento a las 21 del día siguiente al cierre queda afuera", () => {
  // El otro filo del mismo caso: que el 21hs entre no puede significar que
  // entren también los del día de después.
  const afuera = instanteDe("2026-08-17", "21:00");
  assert.equal(diaDe(afuera), "2026-08-17");
  assert.equal(cubreInstante(PERIODO, afuera), false);
});

test("las 23:59 del día anterior al inicio no entran por ser 'casi' el inicio", () => {
  const vispera = instanteDe("2026-08-14", "23:59");
  assert.equal(diaDe(vispera), "2026-08-14");
  assert.equal(cubreInstante(PERIODO, vispera), false);
});

// ---------------------------------------------------------------------------
// 3. Ida y vuelta del formulario
// ---------------------------------------------------------------------------

test("lo que se escribe en el formulario vuelve igual al formulario", () => {
  for (const valor of LOCALES) {
    const instante = instanteDeLocal(valor);
    assert.ok(instante, `no se pudo leer ${valor}`);
    assert.equal(aLocal(instante), valor, `${valor} se movió al ir y volver`);
  }
});

test("la medianoche vuelve como 00:00 del día que empieza, no como 24:00 del anterior", () => {
  // `Intl` con hour12:false puede devolver hora "24" a la medianoche, y ahí el
  // día que acompaña es el de la víspera. Si esa defensa se cae, el formulario
  // muestra un día menos.
  for (const dia of ["2026-08-16", "2027-01-01", "2024-03-01"]) {
    const medianoche = instanteDe(dia, "00:00");
    assert.equal(aLocal(medianoche), `${dia}T00:00`);
    assert.equal(partesDe(medianoche).hour, 0);
    assert.equal(partesDe(medianoche).day, Number(dia.slice(8, 10)));
  }
});

test("el día que muestra el formulario es el mismo que el día del período", () => {
  // `diaDe` y `aLocal` usan dos formateadores distintos: si se desincronizan, el
  // evento se guarda en un período y se muestra con otra fecha.
  for (const iso of INSTANTES) {
    const d = new Date(iso);
    assert.equal(diaDe(d), aLocal(d).slice(0, 10), `desacuerdo en ${iso}`);
  }
});

test("cruzar el año no corre la fecha", () => {
  const finDeAnio = instanteDeLocal("2026-12-31T23:59");
  assert.ok(finDeAnio);
  assert.equal(finDeAnio.toISOString(), "2027-01-01T02:59:00.000Z", "en UTC ya es 2027");
  assert.equal(diaDe(finDeAnio), "2026-12-31");
  assert.equal(aLocal(finDeAnio), "2026-12-31T23:59");

  const arranqueDeAnio = instanteDeLocal("2027-01-01T00:00");
  assert.ok(arranqueDeAnio);
  assert.equal(diaDe(arranqueDeAnio), "2027-01-01");
  assert.equal(aLocal(arranqueDeAnio), "2027-01-01T00:00");
});

test("un valor de formulario que no es una fecha no se convierte en una fecha cualquiera", () => {
  for (const basura of ["", "2026-08-16", "16/08/2026 21:00", "2026-8-16T21:00", "mañana"]) {
    assert.equal(instanteDeLocal(basura), null, `${basura} no debería leerse`);
    assert.equal(partirLocal(basura), null);
  }
  // Con segundos sí se lee: el navegador puede mandarlos y el minuto es válido.
  assert.deepEqual(partirLocal("2026-08-16T21:00:30"), { dia: "2026-08-16", hora: "21:00" });
});

// ---------------------------------------------------------------------------
// 4. Cómo se escribe el rango de un período
// ---------------------------------------------------------------------------

test("un período de un solo día se dice entero, no 'del 18 al 18'", () => {
  assert.equal(fmtRangoDias("2026-08-18", "2026-08-18"), "Mar 18 ago");
  assert.equal(fmtRangoDias("2026-08-18", "2026-08-18").includes(" al "), false);
});

test("dentro del mismo mes el mes se dice una sola vez", () => {
  assert.equal(fmtRangoDias("2026-08-15", "2026-08-16"), "15 al 16 ago");
  assert.equal(fmtRangoDias("2026-08-01", "2026-08-31"), "1 al 31 ago");
});

test("cruzando de mes se nombran los dos meses", () => {
  assert.equal(fmtRangoDias("2026-08-30", "2026-09-01"), "30 ago al 1 sep");
  assert.equal(fmtRangoDias("2026-01-31", "2026-02-02"), "31 ene al 2 feb");
});

test("cruzando de año aparecen los dos años", () => {
  assert.equal(fmtRangoDias("2026-12-30", "2027-01-02"), "30 dic 2026 al 2 ene 2027");
  // Sin el año, "30 dic al 2 ene" se lee como un período de menos de una semana
  // en el mismo año, que es justo lo que no es.
  assert.equal(fmtRangoDias("2026-12-30", "2027-01-02").includes("2027"), true);
});

test("un período sin nombre se muestra por su rango", () => {
  assert.equal(nombreDe({ label: null, startDay: "2026-08-15", endDay: "2026-08-16" }), "15 al 16 ago");
  assert.equal(nombreDe({ label: "   ", startDay: "2026-08-18", endDay: "2026-08-18" }), "Mar 18 ago");
  assert.equal(nombreDe({ label: "Casamiento Pérez", startDay: "2026-08-15", endDay: "2026-08-16" }), "Casamiento Pérez");
});

test("el día suelto se escribe con su día de la semana", () => {
  assert.equal(fmtDia("2026-08-15"), "Sáb 15/8");
  assert.equal(fmtDia("2024-02-29"), "Jue 29/2");
});

// ---------------------------------------------------------------------------
// 5. Aritmética de calendario
// ---------------------------------------------------------------------------

test("no existe el 30 de febrero ni el 29 en un año que no es bisiesto", () => {
  assert.equal(esDia("2026-02-30"), false);
  assert.equal(esDia("2026-02-29"), false);
  assert.equal(esDia("2024-02-29"), true);
  assert.equal(esDia("2026-04-31"), false);
  assert.equal(esDia("2026-02-28"), true);
});

test("una fecha mal escrita no se acomoda sola", () => {
  for (const malo of ["", "2026-13-01", "2026-00-10", "2026-08-00", "2026-08-32", "2026-8-15", "15/08/2026", "2026-08-15T21:00", "hoy"]) {
    assert.equal(esDia(malo), false, `${malo} no es un día de calendario`);
  }
  assert.equal(esDia(undefined as unknown as string), false);
});

test("los días de diferencia cruzan meses, años y el 29 de febrero", () => {
  assert.equal(diasEntre("2026-08-15", "2026-08-16"), 1);
  assert.equal(diasEntre("2026-08-15", "2026-08-15"), 0);
  assert.equal(diasEntre("2026-12-31", "2027-01-01"), 1);
  assert.equal(diasEntre("2024-02-28", "2024-03-01"), 2, "2024 es bisiesto: hay un 29 en el medio");
  assert.equal(diasEntre("2025-02-28", "2025-03-01"), 1, "2025 no es bisiesto");
  assert.equal(diasEntre("2024-01-01", "2025-01-01"), 366);
  assert.equal(diasEntre("2025-01-01", "2026-01-01"), 365);
  assert.equal(diasEntre("2026-08-16", "2026-08-15"), -1, "al revés da negativo, no cero");
});

test("sumar días cruza meses, años y el 29 de febrero", () => {
  assert.equal(sumarDias("2026-12-31", 1), "2027-01-01");
  assert.equal(sumarDias("2027-01-01", -1), "2026-12-31");
  assert.equal(sumarDias("2024-02-28", 1), "2024-02-29");
  assert.equal(sumarDias("2025-02-28", 1), "2025-03-01");
  assert.equal(sumarDias("2024-02-29", 365), "2025-02-28");
  assert.equal(sumarDias("2026-08-15", 0), "2026-08-15");
});

test("sumar y restar son la misma cuenta a lo largo de un año bisiesto entero", () => {
  // Recorrido día por día desde antes del 29 de febrero hasta pasado el fin de
  // año: cada día tiene que ser válido, quedar a un día del anterior y rotar el
  // día de la semana sin saltos. Una sola de estas tres cosas rota si alguien
  // vuelve a usar horas locales para hacer aritmética de calendario.
  let dia = "2024-02-01";
  let semana = diaSemana(dia);
  for (let i = 0; i < 800; i++) {
    const siguiente = sumarDias(dia, 1);
    assert.equal(esDia(siguiente), true, `${siguiente} no es un día válido (venía de ${dia})`);
    assert.equal(diasEntre(dia, siguiente), 1, `${dia} → ${siguiente} no es un día de diferencia`);
    assert.equal(sumarDias(siguiente, -1), dia, `volver de ${siguiente} no da ${dia}`);
    assert.equal(diaSemana(siguiente), (semana + 1) % 7, `el día de la semana saltó en ${siguiente}`);
    assert.equal(diasEntre("2024-02-01", siguiente), i + 1);
    dia = siguiente;
    semana = diaSemana(siguiente);
  }
  assert.equal(dia, sumarDias("2024-02-01", 800));
});

test("el día de la semana de una fecha no depende de ninguna hora", () => {
  assert.equal(diaSemana("2026-08-15"), 6); // sábado
  assert.equal(diaSemana("2026-08-16"), 0); // domingo
  assert.equal(diaSemana("2024-02-29"), 4); // jueves
  assert.equal(diaSemana("2026-12-31"), 4);
  assert.equal(diaSemana("2027-01-01"), 5);
});
