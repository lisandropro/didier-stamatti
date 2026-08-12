import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cubreDia,
  cubreInstante,
  duracion,
  ubicarDia,
  sugerirPeriodo,
  problemaDeRango,
  duplicadoDe,
  eventosQueQuedanFuera,
  rangoQueLosContiene,
  nombreDe,
  periodoDeHoy,
  type Periodo,
} from "../lib/period-fit";
import { diaSemana, fmtRangoDias, instanteDe } from "../lib/dates";

/**
 * La regla de pertenencia: a qué período operativo cae una fecha.
 *
 * Todo acá es puro: no hay base, no hay Prisma, no hay hora del sistema. Lo que
 * se protege es la regla de negocio, que tiene dos filos:
 *
 *  1. Cuando **varios** períodos cubren una fecha, la función NO elige. Antes
 *     había un desempate automático ("el que empieza primero") y eso metía
 *     eventos en el grupo equivocado, o sea contaba vajilla contra el stock
 *     equivocado. Si alguien vuelve a poner un desempate, las pruebas de
 *     superposición se caen.
 *  2. Los días son texto `AAAA-MM-DD` y el día de un evento se calcula en
 *     Argentina. Un evento de las 22 del sábado es UTC del domingo: si alguien
 *     vuelve a leer el día con la zona del proceso, las pruebas de eventos
 *     se caen en un servidor UTC.
 */

// Helpers de armado: períodos y eventos de mentira, mínimos.
const per = (id: string, startDay: string, endDay: string, label: string | null = null): Periodo => ({
  id,
  label,
  startDay,
  endDay,
});

const evento = (id: string, instante: Date) => ({ id, lugar: `Salón ${id}`, date: instante });

// ---------------------------------------------------------------------------
// cubreDia / cubreInstante: los dos extremos entran
// ---------------------------------------------------------------------------

test("un período cubre su día de inicio, su día de fin y todo lo del medio", () => {
  const p = per("p", "2026-08-14", "2026-08-16");
  assert.equal(cubreDia(p, "2026-08-14"), true, "el inicio entra");
  assert.equal(cubreDia(p, "2026-08-15"), true, "el medio entra");
  assert.equal(cubreDia(p, "2026-08-16"), true, "el fin entra");
});

test("un período no cubre el día anterior ni el posterior, ni por uno", () => {
  const p = per("p", "2026-08-14", "2026-08-16");
  assert.equal(cubreDia(p, "2026-08-13"), false);
  assert.equal(cubreDia(p, "2026-08-17"), false);
  // Meses y años distintos se comparan como texto: sin esto, "2026-09-01"
  // podría entrar por comparar números sueltos.
  assert.equal(cubreDia(p, "2026-09-15"), false);
  assert.equal(cubreDia(p, "2025-08-15"), false);
});

test("el día de un evento es el argentino: un evento de las 22 no se va al día siguiente", () => {
  // 2026-08-15 22:00 en Argentina = 2026-08-16 01:00 UTC. En un servidor UTC,
  // leer el día con la zona del proceso lo correría al 16 y lo dejaría fuera
  // de un período que termina el 15.
  const p = per("p", "2026-08-13", "2026-08-15");
  assert.equal(cubreInstante(p, instanteDe("2026-08-15", "22:00")), true);
  assert.equal(cubreInstante(p, new Date("2026-08-16T01:00:00Z")), true);
  // Y un evento de las 00:30 del 16 (argentino) sí queda afuera.
  assert.equal(cubreInstante(p, instanteDe("2026-08-16", "00:30")), false);
});

// ---------------------------------------------------------------------------
// duracion
// ---------------------------------------------------------------------------

test("un período de una sola jornada dura 1 día, no 0", () => {
  assert.equal(duracion(per("p", "2026-08-15", "2026-08-15")), 1);
  assert.equal(duracion(per("p", "2026-08-14", "2026-08-16")), 3);
  // Cruzando fin de mes y fin de año, donde la resta ingenua se rompe.
  assert.equal(duracion(per("p", "2026-08-31", "2026-09-01")), 2);
  assert.equal(duracion(per("p", "2026-12-31", "2027-01-01")), 2);
});

// ---------------------------------------------------------------------------
// ubicarDia: uno, ninguno y —el corazón— varios
// ---------------------------------------------------------------------------

test("un solo período que cubre: se propone ese y listo", () => {
  const periodos = [per("a", "2026-08-14", "2026-08-16"), per("b", "2026-08-20", "2026-08-22")];
  const u = ubicarDia(periodos, "2026-08-15");
  assert.equal(u.tipo, "uno");
  assert.equal(u.tipo === "uno" && u.periodo.id, "a");
});

test("ningún período cubre: se sugiere ESE día suelto, no el fin de semana", () => {
  const periodos = [per("a", "2026-08-14", "2026-08-16")];
  // Martes 18 de agosto de 2026: la empresa trabaja todos los días, así que la
  // sugerencia es el martes, no "de viernes a domingo" como en el modelo viejo.
  const u = ubicarDia(periodos, "2026-08-18");
  assert.equal(u.tipo, "ninguno");
  assert.equal(u.tipo === "ninguno" && u.sugerido.startDay, "2026-08-18");
  assert.equal(u.tipo === "ninguno" && u.sugerido.endDay, "2026-08-18");
  assert.equal(u.tipo === "ninguno" && duracion(u.sugerido), 1);
});

test("sin ningún período cargado tampoco se rompe: sugiere el día pedido", () => {
  const u = ubicarDia([], "2026-03-03");
  assert.equal(u.tipo, "ninguno");
  assert.equal(u.tipo === "ninguno" && cubreDia(u.sugerido, "2026-03-03"), true);
});

test("SUPERPOSICIÓN: con dos períodos que cubren la fecha devuelve los dos y no elige", () => {
  const largo = per("largo", "2026-08-10", "2026-08-20");
  const corto = per("corto", "2026-08-15", "2026-08-15");
  const u = ubicarDia([largo, corto], "2026-08-15");
  assert.equal(u.tipo, "varios", "con dos candidatos no puede resolver sola");
  const ids = u.tipo === "varios" ? u.candidatos.map((p) => p.id) : [];
  assert.deepEqual([...ids].sort(), ["corto", "largo"], "están los dos, no se descarta ninguno");
});

test("SUPERPOSICIÓN: con tres períodos devuelve los tres, y solo los que cubren", () => {
  const periodos = [
    per("uno", "2026-08-14", "2026-08-16"),
    per("dos", "2026-08-15", "2026-08-15"),
    per("tres", "2026-08-01", "2026-08-31"),
    per("afuera", "2026-08-16", "2026-08-18"), // empieza justo después del día
    per("lejos", "2026-09-01", "2026-09-30"),
  ];
  const u = ubicarDia(periodos, "2026-08-15");
  assert.equal(u.tipo, "varios");
  const ids = u.tipo === "varios" ? u.candidatos.map((p) => p.id) : [];
  assert.deepEqual([...ids].sort(), ["dos", "tres", "uno"], "los tres que cubren, ninguno más");
});

test("SUPERPOSICIÓN: el orden es siempre el mismo, no importa cómo vengan cargados", () => {
  // Determinístico ≠ resuelto: la lista se muestra siempre igual, pero sigue
  // siendo una lista para que elija la persona.
  const a = per("a", "2026-08-14", "2026-08-16");
  const b = per("b", "2026-08-15", "2026-08-15");
  const c = per("c", "2026-08-01", "2026-08-31");
  const permutaciones = [
    [a, b, c],
    [c, b, a],
    [b, c, a],
    [a, c, b],
    [c, a, b],
    [b, a, c],
  ];
  const ordenes = permutaciones.map((ps) => {
    const u = ubicarDia(ps, "2026-08-15");
    return u.tipo === "varios" ? u.candidatos.map((p) => p.id).join(",") : `ROTO:${u.tipo}`;
  });
  assert.equal(new Set(ordenes).size, 1, `el orden cambió según la entrada: ${ordenes.join(" | ")}`);
  // El más ajustado primero: es lo que se muestra arriba en la lista.
  assert.equal(ordenes[0], "b,a,c");
});

test("SUPERPOSICIÓN: dos períodos con el mismo rango exacto siguen siendo dos candidatos", () => {
  // El caso feo: no hay ninguna diferencia entre ellos, así que un desempate
  // "razonable" sería inventado. Se muestran los dos, en orden estable por id.
  const u = ubicarDia([per("zeta", "2026-08-15", "2026-08-15"), per("alfa", "2026-08-15", "2026-08-15")], "2026-08-15");
  assert.equal(u.tipo, "varios");
  assert.deepEqual(u.tipo === "varios" ? u.candidatos.map((p) => p.id) : [], ["alfa", "zeta"]);
});

test("ubicarDia no toca el arreglo que recibe", () => {
  const periodos = [per("a", "2026-08-01", "2026-08-31"), per("b", "2026-08-15", "2026-08-15")];
  const antes = periodos.map((p) => p.id);
  ubicarDia(periodos, "2026-08-15");
  assert.deepEqual(
    periodos.map((p) => p.id),
    antes,
    "ordenar para mostrar no puede reordenar la lista del que llama"
  );
});

// ---------------------------------------------------------------------------
// sugerirPeriodo
// ---------------------------------------------------------------------------

test("la sugerencia siempre cubre la fecha que la originó, los siete días de la semana", () => {
  // Lun 2026-08-10 a Dom 2026-08-16: una semana entera.
  const semana = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"];
  const vistos = new Set<number>();
  for (const dia of semana) {
    const s = sugerirPeriodo(dia);
    assert.equal(cubreDia(s, dia), true, `la sugerencia para ${dia} no cubre ${dia}`);
    assert.equal(duracion(s), 1, `la sugerencia para ${dia} debería ser de un solo día`);
    vistos.add(diaSemana(dia));
  }
  assert.equal(vistos.size, 7, "la lista de prueba tiene que recorrer los siete días");
});

test("la sugerencia de un martes no arrastra el fin de semana", () => {
  const s = sugerirPeriodo("2026-08-18"); // martes
  // Lo primero y más importante: es EXACTAMENTE ese martes. Mirar solo los días
  // que quedan afuera no alcanza — una regla "de viernes a domingo" devolvería
  // el finde ANTERIOR (14 al 16), que tampoco toca el viernes 21 ni el lunes 17
  // y sin embargo ni siquiera contiene el evento que la originó.
  assert.deepEqual(s, { startDay: "2026-08-18", endDay: "2026-08-18" });
  assert.equal(cubreDia(s, "2026-08-18"), true, "la sugerencia tiene que contener al evento que la pidió");
  // Y ninguno de los dos fines de semana vecinos entra, ni el de atrás ni el de adelante.
  for (const finde of ["2026-08-14", "2026-08-15", "2026-08-16", "2026-08-21", "2026-08-22", "2026-08-23"]) {
    assert.equal(cubreDia(s, finde), false, `${finde} es fin de semana y no tiene por qué entrar`);
  }
  assert.equal(cubreDia(s, "2026-08-17"), false, "el lunes tampoco");
});

// ---------------------------------------------------------------------------
// problemaDeRango
// ---------------------------------------------------------------------------

test("un rango normal y uno de un solo día son válidos", () => {
  assert.equal(problemaDeRango("2026-08-14", "2026-08-16"), null);
  assert.equal(problemaDeRango("2026-08-15", "2026-08-15"), null, "una sola jornada es un período normal");
});

test("el fin anterior al inicio se rechaza", () => {
  const problema = problemaDeRango("2026-08-16", "2026-08-14");
  assert.notEqual(problema, null);
  assert.match(String(problema), /anterior/i);
});

test("las fechas inválidas o vacías se rechazan antes de comparar nada", () => {
  const malas: [string, string][] = [
    ["", "2026-08-16"],
    ["2026-08-15", ""],
    ["2026-02-30", "2026-03-01"], // febrero no tiene 30
    ["2026-13-01", "2026-13-02"], // mes 13
    ["15/08/2026", "16/08/2026"], // formato de la calle
    ["2026-8-15", "2026-08-16"], // sin cero adelante: rompe la comparación por texto
  ];
  for (const [a, b] of malas) {
    assert.notEqual(problemaDeRango(a, b), null, `"${a}" a "${b}" debería rechazarse`);
  }
});

test("un rango absurdo de más de un año se avisa, pero uno de un año pasa", () => {
  assert.equal(problemaDeRango("2026-01-01", "2027-01-01"), null, "un año justo sigue siendo posible");
  const problema = problemaDeRango("2026-01-01", "2036-01-01"); // año mal tipeado
  assert.notEqual(problema, null);
  assert.match(String(problema), /año/i);
});

// ---------------------------------------------------------------------------
// duplicadoDe
// ---------------------------------------------------------------------------

test("mismo rango exacto es duplicado; un día distinto ya no lo es", () => {
  const periodos = [per("a", "2026-08-14", "2026-08-16"), per("b", "2026-08-20", "2026-08-22")];
  assert.equal(duplicadoDe(periodos, "2026-08-14", "2026-08-16")?.id, "a");
  assert.equal(duplicadoDe(periodos, "2026-08-14", "2026-08-17"), null, "un fin distinto es otro período");
  assert.equal(duplicadoDe(periodos, "2026-08-13", "2026-08-16"), null, "un inicio distinto es otro período");
  // Solapado pero no idéntico: NO es duplicado, la superposición está permitida.
  assert.equal(duplicadoDe(periodos, "2026-08-15", "2026-08-15"), null);
});

test("al editar un período, su propio rango no cuenta como duplicado", () => {
  const periodos = [per("a", "2026-08-14", "2026-08-16"), per("b", "2026-08-20", "2026-08-22")];
  assert.equal(duplicadoDe(periodos, "2026-08-14", "2026-08-16", "a"), null, "guardar sin cambiar fechas no es duplicar");
  // Pero pisar el rango de OTRO sí se detecta aunque se esté editando.
  assert.equal(duplicadoDe(periodos, "2026-08-20", "2026-08-22", "a")?.id, "b");
});

// ---------------------------------------------------------------------------
// eventosQueQuedanFuera / rangoQueLosContiene
// ---------------------------------------------------------------------------

test("al achicar un período se sabe exactamente qué eventos quedan afuera", () => {
  const eventos = [
    evento("e14", instanteDe("2026-08-14", "21:00")),
    evento("e15", instanteDe("2026-08-15", "13:00")),
    evento("e16", instanteDe("2026-08-16", "20:30")),
  ];
  // El período iba del 14 al 16 y se achica al 15.
  const fuera = eventosQueQuedanFuera(eventos, "2026-08-15", "2026-08-15");
  assert.deepEqual(
    fuera.map((e) => e.id),
    ["e14", "e16"]
  );
  // Con el rango original no queda nadie afuera.
  assert.deepEqual(eventosQueQuedanFuera(eventos, "2026-08-14", "2026-08-16"), []);
});

test("el evento de la noche se mide por su día argentino, no por el UTC", () => {
  // 22:00 del sábado 15 = domingo 16 en UTC. Si el período termina el 15, este
  // evento entra; leerlo en UTC lo dejaría afuera y avisaría un problema falso.
  const nocturno = [evento("noche", instanteDe("2026-08-15", "22:00"))];
  assert.deepEqual(eventosQueQuedanFuera(nocturno, "2026-08-15", "2026-08-15"), []);
  assert.deepEqual(
    eventosQueQuedanFuera(nocturno, "2026-08-16", "2026-08-16").map((e) => e.id),
    ["noche"]
  );
});

test("el rango mínimo que contiene a los eventos ignora el orden en que vengan", () => {
  const eventos = [
    evento("c", instanteDe("2026-09-02", "12:00")),
    evento("a", instanteDe("2026-08-30", "22:00")), // cruza a septiembre en UTC
    evento("b", instanteDe("2026-08-31", "18:00")),
  ];
  const rango = rangoQueLosContiene(eventos);
  assert.deepEqual(rango, { startDay: "2026-08-30", endDay: "2026-09-02" });
  // Y el rango que se ofrece de arreglo tiene que dejar a todos adentro.
  assert.deepEqual(eventosQueQuedanFuera(eventos, rango!.startDay, rango!.endDay), []);
});

// ---------------------------------------------------------------------------
// nombreDe / periodoDeHoy: el label es OPCIONAL desde el cambio de modelo
// ---------------------------------------------------------------------------

test("un período sin nombre se muestra por su rango, y uno con nombre en blanco también", () => {
  const rango = fmtRangoDias("2026-08-14", "2026-08-16");
  // Los tres casos de "no tiene nombre": null, vacío y solo espacios. El último
  // es el que se cuela si alguien abre el campo, aprieta la barra y guarda: con
  // un `??` en vez de un `|| trim` se mostraría un período llamado " ".
  assert.equal(nombreDe(per("p", "2026-08-14", "2026-08-16", null)), rango);
  assert.equal(nombreDe(per("p", "2026-08-14", "2026-08-16", "")), rango);
  assert.equal(nombreDe(per("p", "2026-08-14", "2026-08-16", "   ")), rango);
  assert.notEqual(rango.trim(), "", "el rango tiene que ser algo legible, no vacío");
});

test("un período con nombre se muestra por su nombre, no por el rango", () => {
  assert.equal(nombreDe(per("p", "2026-08-14", "2026-08-16", "Casamiento Pérez")), "Casamiento Pérez");
});

test("el período que se ofrece por defecto es el día de hoy, de un solo día", () => {
  const p = periodoDeHoy("2026-08-12");
  assert.deepEqual(p, { startDay: "2026-08-12", endDay: "2026-08-12" });
  assert.equal(duracion(p), 1);
  assert.equal(cubreDia(p, "2026-08-12"), true);
});

test("un solo evento da un rango de un día; sin eventos no hay rango que ofrecer", () => {
  assert.deepEqual(rangoQueLosContiene([{ date: instanteDe("2026-08-15", "21:00") }]), {
    startDay: "2026-08-15",
    endDay: "2026-08-15",
  });
  assert.equal(rangoQueLosContiene([]), null);
});
