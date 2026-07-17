import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { fmtEventDate } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";
import { Cartel } from "@/components/Cartel";

export const dynamic = "force-dynamic";

const SECTORS = ["ENSERES", "MOBILIARIO", "BEBIDA"];
const CAT_LABEL: Record<string, string> = { ENSERES: "Enseres", BEBIDA: "Bebida", MOBILIARIO: "Mobiliario" };

export default async function CartelSectorPage({
  params,
}: {
  params: Promise<{ id: string; sector: string }>;
}) {
  const { id, sector: sectorParam } = await params;
  const sector = sectorParam.toUpperCase();
  if (!SECTORS.includes(sector)) notFound();

  const ev = await prisma.event.findUnique({ where: { id } });
  if (!ev) notFound();

  return (
    <>
      <div className="topbar no-print">
        <div>
          <h1>Cartel — {CAT_LABEL[sector]}</h1>
          <div className="sub">{ev.lugar} · para reimprimir las veces que haga falta</div>
        </div>
        <div className="spacer" />
        <Link className="btn ghost" href={`/evento/${ev.id}/pdf`}>Volver al pedido</Link>
        <PrintButton />
      </div>

      <div className="content pdf-content">
        <Cartel sector={sector} lugar={ev.lugar} dateLabel={fmtEventDate(ev.date)} />
      </div>
    </>
  );
}
