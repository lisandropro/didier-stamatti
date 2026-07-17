const SECTOR_LABEL: Record<string, string> = {
  ENSERES: "Enseres",
  BEBIDA: "Bebida",
  MOBILIARIO: "Mobiliario",
};

/** Cartel minimalista A4 horizontal para pegar en el pedido de un sector
 *  (Enseres/Bebida/Mobiliario), para no confundirlo con el de otro depósito. */
export function Cartel({
  sector,
  lugar,
  dateLabel,
}: {
  sector: string;
  lugar: string;
  dateLabel: string;
}) {
  return (
    <div className="cartel-page">
      <span className="logo-mark cartel-logo" role="img" aria-label="Didier Stamatti Catering" />
      <div className="cartel-label">{SECTOR_LABEL[sector] ?? sector}</div>
      <div className="cartel-lugar">{lugar}</div>
      <div className="cartel-date">{dateLabel}</div>
    </div>
  );
}
