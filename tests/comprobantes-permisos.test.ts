import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLES,
  ROLE_LABEL,
  ROLE_HELP,
  canCapturarComprobantes,
  canVerImportes,
  canPagar,
  canAdministrarComprobantes,
} from "../lib/permissions";

/**
 * La matriz del módulo de comprobantes, entera y con los `false` escritos,
 * igual que la de `permissions.test.ts`: de un permiso importa sobre todo lo
 * que NO deja hacer.
 *
 * La fila que sostiene el diseño es RECEPCION con `verImportes: false`. El
 * depósito saca la foto y nunca recibe un importe — no porque la pantalla lo
 * esconda, sino porque el dato no sale del servidor. Es lo que hace aceptable
 * meter un módulo de plata dentro de una app que usa todo el equipo.
 */
const MATRIZ = {
  ADMIN: { capturar: true, verImportes: true, pagar: true, administrar: true },
  RECEPCION: { capturar: true, verImportes: false, pagar: false, administrar: false },
  PAGOS: { capturar: false, verImportes: true, pagar: true, administrar: false },
  ARMADOR: { capturar: false, verImportes: false, pagar: false, administrar: false },
  LOGISTICA: { capturar: false, verImportes: false, pagar: false, administrar: false },
} as const;

for (const [rol, esperado] of Object.entries(MATRIZ)) {
  test(`permisos de comprobantes para ${rol}`, () => {
    assert.equal(canCapturarComprobantes(rol), esperado.capturar);
    assert.equal(canVerImportes(rol), esperado.verImportes);
    assert.equal(canPagar(rol), esperado.pagar);
    assert.equal(canAdministrarComprobantes(rol), esperado.administrar);
  });
}

test("un rol inventado no puede nada", () => {
  for (const fn of [canCapturarComprobantes, canVerImportes, canPagar, canAdministrarComprobantes]) {
    assert.equal(fn("SUPERUSUARIO"), false);
    assert.equal(fn(""), false);
  }
});

test("los roles nuevos están registrados y tienen nombre", () => {
  assert.ok(ROLES.includes("RECEPCION"));
  assert.ok(ROLES.includes("PAGOS"));
  for (const r of ROLES) {
    assert.ok(ROLE_LABEL[r], `falta el nombre de ${r}`);
    assert.ok(ROLE_HELP[r], `falta la descripción de ${r}`);
  }
});
