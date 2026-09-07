import { test } from "node:test";
import assert from "node:assert/strict";
import {
  huellaDeMovimiento,
  conOrdenDiario,
  controlarSaldos,
  categoriaSugerida,
  type MovimientoNormalizado,
} from "../lib/comprobantes/banco";
import { tipoReal } from "../lib/comprobantes/archivos";

function mov(p: Partial<MovimientoNormalizado> = {}): MovimientoNormalizado {
  return { fechaContable: "2026-08-05", descripcion: "TRANSFERENCIA", importe: -150000n, ...p };
}

test("el mismo movimiento importado dos veces da la misma huella", () => {
  const m = mov();
  assert.equal(huellaDeMovimiento("c1", m, 1), huellaDeMovimiento("c1", { ...m }, 1));
});

test("dos movimientos identicos el mismo dia NO se confunden", () => {
  // Dos transferencias iguales el mismo dia son legitimas. Sin el orden diario
  // la segunda se descartaria como repetida y se perderia plata que si salio.
  const m = mov();
  assert.notEqual(huellaDeMovimiento("c1", m, 1), huellaDeMovimiento("c1", m, 2));
});

test("el mismo movimiento en dos cuentas distintas no colisiona", () => {
  const m = mov();
  assert.notEqual(huellaDeMovimiento("c1", m, 1), huellaDeMovimiento("c2", m, 1));
});

test("el espaciado que cambia entre exportaciones no genera un duplicado", () => {
  const a = mov({ descripcion: "PAGO  PROVEEDOR   SA" });
  const b = mov({ descripcion: "pago proveedor sa" });
  assert.equal(huellaDeMovimiento("c1", a, 1), huellaDeMovimiento("c1", b, 1));
});

test("si el banco da un id propio, se usa ese", () => {
  const h = huellaDeMovimiento("c1", mov({ idExterno: "MOV-99" }), 1);
  assert.equal(h, "ext:c1:MOV-99");
  // Y entonces la posicion dentro del dia deja de importar.
  assert.equal(h, huellaDeMovimiento("c1", mov({ idExterno: "MOV-99" }), 7));
});

test("el orden se numera por dia, no corrido", () => {
  const r = conOrdenDiario([
    mov({ fechaContable: "2026-08-05" }),
    mov({ fechaContable: "2026-08-05" }),
    mov({ fechaContable: "2026-08-06" }),
  ]);
  assert.deepEqual(r.map((x) => x.orden), [1, 2, 1]);
});

test("la cadena de saldos detecta una fila que falta", () => {
  // Tres movimientos de -1000 desde 10000, pero el del medio no vino.
  const r = controlarSaldos([
    mov({ importe: -100000n, saldoPosterior: 900000n }),
    mov({ importe: -100000n, saldoPosterior: 700000n }), // deberia ser 800000
  ]);
  assert.equal(r.cierra, false);
  if (r.cierra === false) {
    assert.equal(r.enLinea, 2);
    assert.equal(r.esperado, 800000n);
    assert.equal(r.declarado, 700000n);
  }
});

test("una cadena de saldos completa cierra", () => {
  const r = controlarSaldos([
    mov({ importe: -100000n, saldoPosterior: 900000n }),
    mov({ importe: -100000n, saldoPosterior: 800000n }),
    mov({ importe: 50000n, saldoPosterior: 850000n }),
  ]);
  assert.equal(r.cierra, true);
});

test("sin saldos no se puede verificar, y eso NO es un error", () => {
  // "No se puede saber" y "esta mal" son cosas distintas. Confundirlas seria
  // rechazar un extracto perfectamente valido de un banco que no imprime saldo.
  assert.equal(controlarSaldos([mov(), mov()]).cierra, null);
});

test("los conceptos bancarios se reconocen y un pago no", () => {
  assert.equal(categoriaSugerida("IMP. LEY 25.413 DEBITOS"), "IMPUESTO_25413");
  assert.equal(categoriaSugerida("RETENCION SIRCREB"), "SIRCREB");
  assert.equal(categoriaSugerida("COMISION MANTENIMIENTO CUENTA"), "COMISION");
  assert.equal(categoriaSugerida("TRANSFERENCIA A DISTRIBUIDORA SRL"), null);
});

test("un ejecutable renombrado a .jpg no pasa", () => {
  // `f.type` decia image/jpeg porque la extension lo decia. Los bytes no.
  const mz = new Uint8Array(16);
  mz[0] = 0x4d; mz[1] = 0x5a; // "MZ"
  assert.equal(tipoReal(mz), null);
});

test("las firmas reales se reconocen", () => {
  const jpg = new Uint8Array(16); jpg.set([0xff, 0xd8, 0xff]);
  assert.equal(tipoReal(jpg), "image/jpeg");

  const png = new Uint8Array(16); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(tipoReal(png), "image/png");

  const pdf = new Uint8Array(16); pdf.set([0x25, 0x50, 0x44, 0x46]);
  assert.equal(tipoReal(pdf), "application/pdf");

  // WEBP: "RIFF" + tamano + "WEBP". El tamano en el medio es variable.
  const webp = new Uint8Array(16);
  webp.set([0x52, 0x49, 0x46, 0x46, 0x2a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(tipoReal(webp), "image/webp");
});

test("un archivo mas corto que la firma no se adivina", () => {
  assert.equal(tipoReal(new Uint8Array([0xff, 0xd8, 0xff])), null);
});
