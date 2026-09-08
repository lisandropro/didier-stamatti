import { test } from "node:test";
import assert from "node:assert/strict";
import { avisoDe, type HealthProblem } from "../lib/healthcheck";

/**
 * A quién se interrumpe, y por qué.
 *
 * **De dónde salió esto.** La revisión diaria reportaba siete problemas y los
 * mandaba a los administradores en una sola frase. Al preguntar si eran ruido,
 * la respuesta fue que no: son ciertos, pero piden horas de trabajo que hoy no
 * existen.
 *
 * Un aviso que pide tiempo que no hay se ignora igual que uno falso — y al
 * ignorarse entrena a ignorar TODOS, incluido el día que falle el respaldo o se
 * esté por pagar dos veces la misma factura.
 *
 * Así que lo que se prueba acá no es un formato de mensaje: es que **el trabajo
 * pendiente no pueda ni disparar el aviso ni tapar al urgente**.
 */

const p = (code: string, gravedad: HealthProblem["gravedad"]): HealthProblem => ({
  code,
  gravedad,
  message: `mensaje de ${code}`,
});

/** Lo que la revisión reportaba de verdad en producción el 08/09/2026. */
const LOS_SIETE: HealthProblem[] = [
  p("stock-empty", "media"),
  p("evento-sin-pedido", "alta"),
  p("evento-sin-invitados", "media"),
  p("listo-sin-responsable", "media"),
  p("producto-sin-contar", "media"),
  p("usuarios-sin-push", "media"),
  p("comprobante-sin-vencimiento", "media"),
];

test("el trabajo pendiente NO interrumpe", () => {
  // Seis de los siete son trabajo real que no entra en el día. Ninguno de ellos
  // justifica un push: quedan en /notificaciones.
  const soloPendiente = LOS_SIETE.filter((x) => x.gravedad !== "alta");
  assert.equal(avisoDe(soloPendiente), null);
});

test("lo urgente sí interrumpe, y llega solo", () => {
  const av = avisoDe(LOS_SIETE);
  assert.ok(av, "no avisó habiendo un problema grave");
  assert.match(av.message, /evento-sin-pedido/);
  // Y sobre todo: los otros seis NO están en el mensaje. Antes iban todos y el
  // urgente quedaba en el medio de la oración.
  assert.doesNotMatch(av.message, /producto-sin-contar/);
  assert.doesNotMatch(av.message, /stock-empty/);
});

test("cambiar el trabajo pendiente NO vuelve a avisar", () => {
  // El bug viejo: la firma era el conjunto de TODOS los códigos. Cargar un
  // producto sin contar la cambiaba, y salía un aviso nuevo con los siete
  // adentro — todos los días, hasta que dejaban de mirarse.
  const antes = avisoDe(LOS_SIETE)!;
  const despues = avisoDe([...LOS_SIETE, p("otro-pendiente", "media")])!;
  assert.equal(antes.signature, despues.signature, "un pendiente nuevo cambió la firma");
});

test("un problema urgente nuevo SÍ vuelve a avisar", () => {
  // La otra mitad: la firma tiene que seguir cambiando cuando aparece algo
  // grave, o un respaldo roto quedaría callado siete días.
  const antes = avisoDe(LOS_SIETE)!;
  const despues = avisoDe([...LOS_SIETE, p("backup-old-comprobantes", "alta")])!;
  assert.notEqual(antes.signature, despues.signature);
  assert.match(despues.message, /backup-old-comprobantes/);
});

test("la firma no depende del orden", () => {
  // Si dependiera, el mismo problema avisaría de nuevo solo porque las
  // consultas devolvieron los resultados en otro orden.
  const a = avisoDe([p("backup-old-stock", "alta"), p("comprobante-duplicado", "alta")])!;
  const b = avisoDe([p("comprobante-duplicado", "alta"), p("backup-old-stock", "alta")])!;
  assert.equal(a.signature, b.signature);
});

test("sin problemas no hay aviso", () => {
  assert.equal(avisoDe([]), null);
});
