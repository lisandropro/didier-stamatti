import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { CLAVE_MINIMA, COSTO_BCRYPT, claveCorrecta, hashearClave, problemaDeClave } from "../lib/clave";
import { mismoNombre } from "../lib/nombre-de-persona";
import { crearLimiteDeIngreso, direccionDe } from "../lib/login-limit";
import { duraUnMes, issueSessionToken } from "../lib/session-token";

process.env.AUTH_SECRET = "test-only-secret-never-use-in-production-12345678";

test("una contraseña razonable pasa", () => {
  assert.equal(problemaDeClave("mesa-Larga-42"), null);
  assert.equal(problemaDeClave("ñandú con tilde"), null);
  assert.equal(problemaDeClave("a".repeat(4) + "b1c2"), null);
});

test("corta, larga, vacía o que no es texto: se rechaza con un mensaje, no con una excepción", () => {
  assert.match(problemaDeClave("abc1234")!, new RegExp(`al menos ${CLAVE_MINIMA}`));
  assert.match(problemaDeClave("")!, /Poné una contraseña/);
  for (const raro of [null, undefined, 12345678, {}, ["12345678"]]) {
    assert.match(problemaDeClave(raro)!, /Poné una contraseña/);
  }
  // bcrypt ignora lo que pasa de 72 bytes: dos claves distintas valdrían lo mismo.
  assert.match(problemaDeClave("x1".repeat(40))!, /demasiado larga/);
  // 72 bytes, no 72 letras: la eñe ocupa dos.
  assert.match(problemaDeClave("ñ".repeat(30) + "abcdefghijklmn")!, /demasiado larga/);
  assert.match(problemaDeClave("        ")!, /espacios|adivinar/);
});

test("las obvias para esta app no pasan, tampoco con mayúsculas o tildes", () => {
  for (const obvia of ["12345678", "didier123", "Didier2026", "CONTRASEÑA", "contrasena", "password", "aaaaaaaa", "abababab"]) {
    assert.ok(problemaDeClave(obvia), obvia);
  }
});

test("no puede ser el nombre ni el email de la persona", () => {
  const persona = { email: "aldana.cicerchia@example.test", name: "Aldana Cicerchia" };
  assert.match(problemaDeClave("aldana.cicerchia@example.test", persona)!, /nombre ni tu email/);
  assert.match(problemaDeClave("aldana.cicerchia", persona)!, /nombre ni tu email/);
  assert.match(problemaDeClave("ALDANA CICERCHIA", persona)!, /nombre ni tu email/);
  assert.equal(problemaDeClave("aldana.cicerchia+2026", persona), null);
});

test("las contraseñas viejas, guardadas con otro costo, siguen entrando", async () => {
  const vieja = bcrypt.hashSync("la-de-antes-1", 4);
  assert.equal(await claveCorrecta("la-de-antes-1", vieja), true);
  assert.equal(await claveCorrecta("otra-cosa-22", vieja), false);
  const nueva = await hashearClave("mesa-Larga-42");
  assert.equal(bcrypt.getRounds(nueva), COSTO_BCRYPT);
  assert.equal(await claveCorrecta("mesa-Larga-42", nueva), true);
});

test("sin cuenta, la comparación se hace igual y da falso", async () => {
  assert.equal(await claveCorrecta("lo-que-sea-1", null), false);
  assert.equal(await claveCorrecta("lo-que-sea-1", undefined), false);
  assert.equal(await claveCorrecta("lo-que-sea-1", ""), false);
});

test("dos nombres son el mismo sin mirar mayúsculas, tildes ni espacios", () => {
  assert.equal(mismoNombre("Hernán", "hernan "), true);
  assert.equal(mismoNombre("Ana  María", "ana maria"), true);
  assert.equal(mismoNombre("Enrique", "Enrique V."), false);
});

test("ingreso: 10 intentos por correo desde una dirección, sin bloquear a la persona desde otra", () => {
  const limite = crearLimiteDeIngreso({ ventanaMs: 1000 });
  for (let i = 0; i < 10; i++) assert.equal(limite.permitir("lisa@x.test", "1.1.1.1", i), true);
  assert.equal(limite.permitir("lisa@x.test", "1.1.1.1", 11), false);
  // La dueña de la cuenta, desde su casa, entra igual.
  assert.equal(limite.permitir("lisa@x.test", "2.2.2.2", 12), true);
  // Pasada la ventana, vuelve a poder.
  assert.equal(limite.permitir("lisa@x.test", "1.1.1.1", 1100), true);
});

test("ingreso: entrar bien pone en cero la cuenta de esa dirección", () => {
  const limite = crearLimiteDeIngreso({ ventanaMs: 1000 });
  for (let i = 0; i < 10; i++) limite.permitir("lisa@x.test", "1.1.1.1", i);
  limite.ingresoCorrecto("lisa@x.test", "1.1.1.1");
  assert.equal(limite.permitir("lisa@x.test", "1.1.1.1", 20), true);
});

test("ingreso: una dirección no puede probar más de 30 correos, y al rechazarla no anota nada más", () => {
  const limite = crearLimiteDeIngreso({ ventanaMs: 1000, capacidad: 40 });
  for (let i = 0; i < 30; i++) assert.equal(limite.permitir(`c${i}@x.test`, "9.9.9.9", i), true);
  // Miles de correos inventados desde la misma dirección: todos rechazados...
  for (let i = 30; i < 500; i++) assert.equal(limite.permitir(`c${i}@x.test`, "9.9.9.9", 40), false);
  // ...y sin llenar la memoria de los demás: otra persona entra.
  assert.equal(limite.permitir("lisa@x.test", "2.2.2.2", 50), true);
});

test("ingreso: repartir los intentos entre direcciones tiene techo (50 por correo)", () => {
  const limite = crearLimiteDeIngreso({ ventanaMs: 1000 });
  let pasaron = 0;
  for (let ip = 0; ip < 10; ip++) {
    for (let i = 0; i < 10; i++) if (limite.permitir("lisa@x.test", `10.0.0.${ip}`, ip * 10 + i)) pasaron++;
  }
  assert.equal(pasaron, 50);
});

test("ingreso sin dirección conocida: el límite de siempre, 10 por correo", () => {
  const limite = crearLimiteDeIngreso({ ventanaMs: 1000 });
  for (let i = 0; i < 10; i++) assert.equal(limite.permitir("lisa@x.test", null, i), true);
  assert.equal(limite.permitir("lisa@x.test", null, 11), false);
  limite.ingresoCorrecto("lisa@x.test", null);
  assert.equal(limite.permitir("lisa@x.test", null, 12), true);
});

test("la dirección sale de x-real-ip; de x-forwarded-for, solo la última", () => {
  const con = (h: Record<string, string>) => ({ get: (n: string) => h[n] ?? null });
  assert.equal(direccionDe(con({ "x-real-ip": "3.3.3.3", "x-forwarded-for": "6.6.6.6" })), "3.3.3.3");
  // La primera la escribe quien manda el pedido: no se le cree.
  assert.equal(direccionDe(con({ "x-forwarded-for": "6.6.6.6, 4.4.4.4" })), "4.4.4.4");
  assert.equal(direccionDe(con({})), null);
});

test("renovar la sesión respeta si era de un mes o de 8 horas", async () => {
  const cuenta = { id: "u1", name: "Prueba", role: "ADMIN", email: "p@x.test", passwordHash: "h" };
  assert.equal(duraUnMes(await issueSessionToken(cuenta, true)), true);
  assert.equal(duraUnMes(await issueSessionToken(cuenta, false)), false);
  assert.equal(duraUnMes("no-es-un-token"), false);
});
