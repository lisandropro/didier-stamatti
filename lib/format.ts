const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// "Sáb 5/7 · 21hs"
export function fmtEventDate(d: Date): string {
  const wd = DIAS[d.getDay()];
  const hh = d.getHours();
  const mm = d.getMinutes();
  const hora = mm === 0 ? `${hh}hs` : `${hh}:${String(mm).padStart(2, "0")}`;
  return `${wd} ${d.getDate()}/${d.getMonth() + 1} · ${hora}`;
}

// "5 al 7 jul"
export function fmtRange(a: Date, b: Date): string {
  const sameMonth = a.getMonth() === b.getMonth();
  if (sameMonth) return `${a.getDate()} al ${b.getDate()} ${MESES[b.getMonth()]}`;
  return `${a.getDate()} ${MESES[a.getMonth()]} al ${b.getDate()} ${MESES[b.getMonth()]}`;
}

// "20/7 · 14:32"
export function fmtDateTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()}/${d.getMonth() + 1} · ${hh}:${mm}`;
}

// Medianoche local de hoy — para comparar "¿esto ya pasó?"
export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// "2026-08-15T18:00" — el formato que pide <input type="datetime-local">.
// Se arma con los mismos lectores locales que usa fmtEventDate, así lo que se
// muestra y lo que se edita hablan de la misma hora.
export function toDatetimeLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
