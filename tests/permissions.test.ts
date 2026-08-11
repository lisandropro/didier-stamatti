import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLES,
  ROLE_LABEL,
  canEditOrders,
  canManageWeekends,
  canEditStock,
  canManageCatalog,
  canManageUsers,
  canSetResponsable,
  canView,
  isPriorityRecipient,
  isRole,
  sortByNotificationPriority,
} from "../lib/permissions";

/**
 * La matriz completa: qué puede hacer cada rol. Se escribe entera a propósito,
 * incluyendo los `false`, porque lo que importa de un permiso es sobre todo lo
 * que NO deja hacer. Si mañana alguien afloja una comprobación, esto lo frena.
 */
const MATRIZ = {
  ADMIN: {
    canView: true,
    canEditOrders: true,
    canManageWeekends: true,
    canEditStock: true,
    canManageCatalog: true,
    canManageUsers: true,
    canSetResponsable: true,
  },
  ARMADOR: {
    canView: true,
    canEditOrders: true,
    canManageWeekends: true,
    canEditStock: false,
    canManageCatalog: false,
    canManageUsers: false,
    canSetResponsable: true,
  },
  LOGISTICA: {
    canView: true,
    canEditOrders: false,
    canManageWeekends: false,
    canEditStock: false,
    canManageCatalog: false,
    canManageUsers: false,
    canSetResponsable: true,
  },
} as const;

const FN = {
  canView,
  canEditOrders,
  canManageWeekends,
  canEditStock,
  canManageCatalog,
  canManageUsers,
  canSetResponsable,
};

for (const rol of Object.keys(MATRIZ) as (keyof typeof MATRIZ)[]) {
  for (const cap of Object.keys(MATRIZ[rol]) as (keyof (typeof MATRIZ)["ADMIN"])[]) {
    const esperado = MATRIZ[rol][cap];
    test(`${rol}: ${cap} = ${esperado}`, () => {
      assert.equal(FN[cap](rol), esperado);
    });
  }
}

test("el encargado de logística NO puede escribir nada salvo el responsable", () => {
  const escrituras = [canEditOrders, canManageWeekends, canEditStock, canManageCatalog, canManageUsers];
  for (const puede of escrituras) assert.equal(puede("LOGISTICA"), false);
  assert.equal(canSetResponsable("LOGISTICA"), true);
});

test("un rol desconocido no puede hacer absolutamente nada", () => {
  const inventado = "SUPERUSUARIO";
  assert.equal(isRole(inventado), false);
  assert.equal(canView(inventado), false);
  assert.equal(canEditOrders(inventado), false);
  assert.equal(canManageWeekends(inventado), false);
  assert.equal(canEditStock(inventado), false);
  assert.equal(canManageCatalog(inventado), false);
  assert.equal(canManageUsers(inventado), false);
  assert.equal(canSetResponsable(inventado), false);
});

test("una cadena vacía (sesión sin rol) tampoco habilita nada", () => {
  for (const puede of Object.values(FN)) assert.equal(puede(""), false);
});

test("todos los roles declarados tienen etiqueta para la pantalla", () => {
  for (const r of ROLES) {
    assert.ok(ROLE_LABEL[r], `falta la etiqueta de ${r}`);
  }
});

test("la matriz cubre todos los roles declarados: si se agrega uno, esta prueba falla", () => {
  assert.deepEqual([...ROLES].sort(), Object.keys(MATRIZ).sort());
});

// --- Prioridad de avisos -----------------------------------------------------

test("solo el encargado de logística es destinatario prioritario", () => {
  assert.equal(isPriorityRecipient("LOGISTICA"), true);
  assert.equal(isPriorityRecipient("ADMIN"), false);
  assert.equal(isPriorityRecipient("ARMADOR"), false);
});

test("el encargado va primero en la cola de avisos", () => {
  const orden = sortByNotificationPriority([
    { id: "a", role: "ADMIN" },
    { id: "b", role: "ARMADOR" },
    { id: "p", role: "LOGISTICA" },
  ]);
  assert.equal(orden[0].id, "p");
});

test("el orden es estable: dentro de cada grupo no se altera lo recibido", () => {
  const orden = sortByNotificationPriority([
    { id: "admin1", role: "ADMIN" },
    { id: "log1", role: "LOGISTICA" },
    { id: "armador1", role: "ARMADOR" },
    { id: "log2", role: "LOGISTICA" },
    { id: "admin2", role: "ADMIN" },
  ]);
  assert.deepEqual(
    orden.map((u) => u.id),
    ["log1", "log2", "admin1", "armador1", "admin2"]
  );
});

test("ordenar no pierde ni duplica destinatarios", () => {
  const entrada = [
    { id: "1", role: "ADMIN" },
    { id: "2", role: "LOGISTICA" },
    { id: "3", role: "ARMADOR" },
  ];
  const salida = sortByNotificationPriority(entrada);
  assert.equal(salida.length, entrada.length);
  assert.deepEqual(salida.map((u) => u.id).sort(), ["1", "2", "3"]);
});

test("sin destinatarios prioritarios, el orden queda como estaba", () => {
  const entrada = [
    { id: "1", role: "ADMIN" },
    { id: "2", role: "ARMADOR" },
  ];
  assert.deepEqual(sortByNotificationPriority(entrada), entrada);
});
