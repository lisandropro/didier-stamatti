// Qué stock le queda a un producto cuando pasa de consumible a reutilizable.
//
// Los consumibles se guardan en 0 porque no se cuentan. Ese 0 no es un
// recuento: si viaja tal cual al pasar a reutilizable, el aviso de faltante lo
// lee como "hay cero" y grita por algo que nadie inventarió. Sin pruebas de que
// alguien lo contó, el producto queda SIN CONTAR (null).
//
// El movimiento de stock es la prueba que usó la migración del 19/08. Acá se
// suma "haber sido reutilizable antes": el alta con cero explícito no deja
// movimiento, pero ese cero sí es un dato.

export function stockAlPasarAReutilizable(p: {
  stock: number | null;
  tieneMovimientos: boolean;
  fueReutilizable: boolean;
}): number | null {
  if (p.stock === 0 && !p.tieneMovimientos && !p.fueReutilizable) return null;
  return p.stock;
}
