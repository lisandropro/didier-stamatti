/** Límite por cuenta y por proceso. Para varias réplicas, compartir en proxy/base. */
export function createLoginLimiter(limit = 10, windowMs = 15 * 60_000, capacity = 5_000) {
  const attempts = new Map<string, { count: number; until: number }>();
  return {
    take(key: string, now = Date.now()): boolean {
      const current = attempts.get(key);
      if (current && current.until > now) {
        if (current.count >= limit) return false;
        current.count++;
        return true;
      }
      if (attempts.size >= capacity) {
        for (const [k, value] of attempts) if (value.until <= now) attempts.delete(k);
        if (!attempts.has(key) && attempts.size >= capacity) return false;
      }
      attempts.set(key, { count: 1, until: now + windowMs });
      return true;
    },
    clear(key: string) { attempts.delete(key); },
  };
}

/**
 * Los tres límites del ingreso. Viven en la memoria del proceso: la app corre
 * en una sola instancia, y un reinicio los pone en cero (por eso además las
 * contraseñas tienen un mínimo y bcrypt es lento a propósito).
 *
 * - Por dirección, para cualquier correo: 30 intentos. Va primero y, si
 *   rechaza, no anota nada más: sin esto alcanzaba con probar 5.000 correos
 *   inventados desde una sola máquina para llenar la memoria de los otros dos
 *   y dejar a todos sin poder entrar.
 * - Por correo Y dirección: 10. Es el que frena a quien prueba contraseñas, y
 *   como es por dirección, quien se equivoca desde otro lado no le bloquea la
 *   entrada a la persona de verdad.
 * - Por correo, desde cualquier dirección: 50. Es el techo para quien reparte
 *   los intentos entre muchas direcciones.
 *
 * Sin dirección conocida queda el límite de siempre: 10 por correo.
 */
export function crearLimiteDeIngreso(opciones: { ventanaMs?: number; capacidad?: number } = {}) {
  const ventana = opciones.ventanaMs ?? 15 * 60_000;
  const capacidad = opciones.capacidad ?? 5_000;
  const porDireccion = createLoginLimiter(30, ventana, capacidad);
  const porCorreoYDireccion = createLoginLimiter(10, ventana, capacidad);
  const porCorreo = createLoginLimiter(50, ventana, capacidad);
  const porCorreoSinDireccion = createLoginLimiter(10, ventana, capacidad);
  const par = (email: string, ip: string) => `${ip}|${email}`;
  return {
    /** Anota un intento. `false` = hay que esperar. */
    permitir(email: string, ip: string | null, ahora = Date.now()): boolean {
      if (!ip) return porCorreoSinDireccion.take(email, ahora);
      if (!porDireccion.take(ip, ahora)) return false;
      // Se anotan los dos siempre: cortar en el primero que rechaza dejaría al
      // otro sin contar, y el techo por correo no se alcanzaría nunca.
      const delPar = porCorreoYDireccion.take(par(email, ip), ahora);
      const delCorreo = porCorreo.take(email, ahora);
      return delPar && delCorreo;
    },
    /** Entró bien: su cuenta desde su dirección vuelve a cero. Los techos
     *  generales no: un ingreso correcto no borra los intentos de otros. */
    ingresoCorrecto(email: string, ip: string | null) {
      if (ip) porCorreoYDireccion.clear(par(email, ip));
      else porCorreoSinDireccion.clear(email);
    },
  };
}

export const limiteDeIngreso = crearLimiteDeIngreso();

/**
 * La dirección de quien hace el pedido, o null si no se puede saber.
 *
 * `x-real-ip` lo pone el borde de Railway. `x-forwarded-for` lo puede escribir
 * cualquiera desde su casa, así que solo se usa si falta el otro, y de él se
 * toma la última dirección, que es la que agregó el proxy más cercano.
 */
export function direccionDe(cabeceras: { get(nombre: string): string | null }): string | null {
  const real = cabeceras.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const ultima = cabeceras.get("x-forwarded-for")?.split(",").pop()?.trim();
  return ultima ? ultima.slice(0, 64) : null;
}
