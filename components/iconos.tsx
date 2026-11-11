/* Los íconos de la app, una sola vez.
 *
 * Antes cada pantalla tenía su copia (el triángulo de aviso estaba seis veces)
 * y los trazos iban de 1.8 a 2.4 según quién lo hubiera pegado. Acá todos
 * comparten grosor y terminación, y todos son decoración: el texto de al lado
 * (o el `aria-label` del botón) es lo que se lee.
 *
 * Son elementos, no componentes: se usan como `{IconWarn}`. El tamaño lo pone
 * la hoja de estilos según dónde caigan (`.btn svg`, `.chip svg`, …).
 */

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Triángulo de aviso: faltantes, errores al guardar. */
export const IconWarn = (
  <svg {...base}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
);
/** Aviso suave, en círculo: "sin contar". */
export const IconAviso = (
  <svg {...base}><path d="M12 8v5M12 16h.01" /><circle cx="12" cy="12" r="9" /></svg>
);
export const IconInfo = (
  <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>
);
export const IconTrash = (
  <svg {...base}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 13h9l1-13" /></svg>
);
export const IconPlus = (
  <svg {...base}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconCheck = (
  <svg {...base}><path d="M20 6 9 17l-5-5" /></svg>
);
export const IconEdit = (
  <svg {...base}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
);
export const IconBack = (
  <svg {...base}><path d="m15 18-6-6 6-6" /></svg>
);
export const IconPrint = (
  <svg {...base}><path d="M7 8V3.5h10V8M7 17h10v3.5H7z" /><path d="M4.5 8h15a1.5 1.5 0 0 1 1.5 1.5V16h-4M3 16h4M3 9.5A1.5 1.5 0 0 1 4.5 8" /></svg>
);
export const IconCal = (
  <svg {...base}><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>
);
export const IconHistory = (
  <svg {...base}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 8v4l3 2" /></svg>
);
export const IconPerson = (
  <svg {...base}><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></svg>
);
export const IconPeople = (
  <svg {...base}><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /></svg>
);
export const IconList = (
  <svg {...base}><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" strokeWidth="2.6" /></svg>
);
export const IconUndo = (
  <svg {...base}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-1" /></svg>
);
export const IconCopy = (
  <svg {...base}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>
);
export const IconKey = (
  <svg {...base}><circle cx="8" cy="15" r="4" /><path d="m10.85 12.15 8.15-8.15M18 6l2 2M15 9l1.5 1.5" /></svg>
);
export const IconSearch = (
  <svg {...base}><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
);
export const IconBell = (
  <svg {...base}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
);
/** Un teléfono: las instrucciones para instalar en iPhone. */
export const IconPhone = (
  <svg {...base}><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>
);
export const IconEye = (
  <svg {...base}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const IconEyeOff = (
  <svg {...base}>
    <path d="M3 3l18 18" /><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
    <path d="M9.4 5.2A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.3 3.2M6.2 6.2A17 17 0 0 0 2 12s3.5 7 10 7a9.4 9.4 0 0 0 3.4-.6" />
  </svg>
);
export const IconDown = (
  <svg {...base}><path d="M12 3v12M8 11l4 4 4-4" /><path d="M4 17v2.5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V17" /></svg>
);
export const IconShare = (
  <svg {...base}><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" /><path d="M12 3v13M8 7l4-4 4 4" /></svg>
);
