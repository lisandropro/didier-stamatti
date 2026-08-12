/**
 * Una sola política de fechas para toda la app: el calendario es el de
 * **Argentina**, siempre, sin importar dónde corra el servidor.
 *
 * Por qué existe este archivo: hasta ahora "qué día es este evento" se
 * respondía con los lectores locales de `Date`, o sea con la zona horaria del
 * proceso. El servidor de Railway corre en UTC y una computadora de acá en
 * UTC−3, así que **el mismo dato daba días distintos**: un período guardado
 * como "hasta el 16" se leía "hasta el 15" y un evento del 16 quedaba afuera.
 * Eso ya pasó y costó un rato entenderlo.
 *
 * La regla, en dos partes:
 *
 * 1. **Los días de calendario no son instantes.** El inicio y el fin de un
 *    período se guardan como texto `AAAA-MM-DD`. Un período va del 17 al 19 y
 *    punto: no tiene hora, así que no hay zona que pueda correrlo.
 * 2. **Los eventos sí son instantes** (tienen hora), y su día se calcula
 *    siempre en Argentina, explícitamente, nunca con la zona del proceso.
 *
 * Argentina no cambia la hora desde 2009: es UTC−3 todo el año. Eso permite
 * convertir sin tabla de horarios de verano.
 */

export const ZONA = "America/Argentina/Buenos_Aires";
/** Argentina está fija en UTC−3 desde 2009. */
const OFFSET_MIN = -180;

const FMT_DIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** El día de calendario argentino de un instante, como `AAAA-MM-DD`. */
export function diaDe(instante: Date): string {
  // en-CA da exactamente "AAAA-MM-DD".
  return FMT_DIA.format(instante);
}

const FMT_PARTES = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Año, mes, día, hora y minuto de un instante, en hora argentina. */
export function partesDe(instante: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const p = Object.fromEntries(
    FMT_PARTES.formatToParts(instante)
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, x.value])
  ) as Record<string, string>;
  const hour = Number(p.hour) % 24; // en-CA puede dar "24" a la medianoche
  const dia = `${p.year}-${p.month}-${p.day}`;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour,
    minute: Number(p.minute),
    weekday: diaSemana(dia),
  };
}

/** Qué día de la semana cae una fecha `AAAA-MM-DD`. 0 domingo … 6 sábado. */
export function diaSemana(dia: string): number {
  const [y, m, d] = dia.split("-").map(Number);
  // Se usa UTC a propósito: acá no hay instante ni zona, solo aritmética de
  // calendario, y UTC es la única que no tiene sorpresas.
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** El instante que corresponde a una hora de pared argentina.
 *  `"2026-08-15"`, `"21:00"` → el momento exacto en que son las 21 en Argentina. */
export function instanteDe(dia: string, hora: string): Date {
  const [y, m, d] = dia.split("-").map(Number);
  const [hh, mm] = hora.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - OFFSET_MIN * 60 * 1000);
}

/** Parte un `datetime-local` ("2026-08-15T21:00") en día y hora. */
export function partirLocal(valor: string): { dia: string; hora: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(valor ?? "");
  return m ? { dia: m[1], hora: m[2] } : null;
}

/** `datetime-local` a instante, interpretando la hora como argentina. */
export function instanteDeLocal(valor: string): Date | null {
  const p = partirLocal(valor);
  return p ? instanteDe(p.dia, p.hora) : null;
}

/** Instante a `datetime-local`, para poner en el formulario. */
export function aLocal(instante: Date): string {
  const p = partesDe(instante);
  const dd = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${dd(p.month)}-${dd(p.day)}T${dd(p.hour)}:${dd(p.minute)}`;
}

/** Hoy, en Argentina, como `AAAA-MM-DD`. */
export function hoy(): string {
  return diaDe(new Date());
}

/** ¿Es un `AAAA-MM-DD` de verdad? */
export function esDia(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor ?? "")) return false;
  const [y, m, d] = valor.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Días de diferencia entre dos fechas de calendario. */
export function diasEntre(desde: string, hasta: string): number {
  const [y1, m1, d1] = desde.split("-").map(Number);
  const [y2, m2, d2] = hasta.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Suma días a una fecha de calendario. */
export function sumarDias(dia: string, n: number): string {
  const [y, m, d] = dia.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  const dd = (x: number) => String(x).padStart(2, "0");
  return `${t.getUTCFullYear()}-${dd(t.getUTCMonth() + 1)}-${dd(t.getUTCDate())}`;
}

// ---------------------------------------------------------------------------
// Cómo se muestran
// ---------------------------------------------------------------------------

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** "Sáb 15/8 · 21hs" — un evento, con su día y su hora argentinos. */
export function fmtEvento(instante: Date): string {
  const p = partesDe(instante);
  const hora = p.minute === 0 ? `${p.hour}hs` : `${p.hour}:${String(p.minute).padStart(2, "0")}`;
  return `${DIAS[p.weekday]} ${p.day}/${p.month} · ${hora}`;
}

/** "Sáb 15/8" — solo el día. */
export function fmtDia(dia: string): string {
  const [, m, d] = dia.split("-").map(Number);
  return `${DIAS[diaSemana(dia)]} ${d}/${m}`;
}

/**
 * El rango de un período, escrito como se dice.
 *
 * Un solo día se dice entero ("Mar 18 ago") en vez de "18 al 18": el período de
 * una sola jornada es un caso normal, no un rango degenerado.
 */
export function fmtRangoDias(desde: string, hasta: string): string {
  const [ya, ma, da] = desde.split("-").map(Number);
  const [yb, mb, db] = hasta.split("-").map(Number);
  if (desde === hasta) return `${DIAS[diaSemana(desde)]} ${da} ${MESES[ma - 1]}`;
  if (ya === yb && ma === mb) return `${da} al ${db} ${MESES[mb - 1]}`;
  if (ya === yb) return `${da} ${MESES[ma - 1]} al ${db} ${MESES[mb - 1]}`;
  return `${da} ${MESES[ma - 1]} ${ya} al ${db} ${MESES[mb - 1]} ${yb}`;
}

/** "20/7 · 14:32" — un momento en que pasó algo, en hora argentina. */
export function fmtMomento(instante: Date): string {
  const p = partesDe(instante);
  const dd = (n: number) => String(n).padStart(2, "0");
  return `${p.day}/${p.month} · ${dd(p.hour)}:${dd(p.minute)}`;
}
