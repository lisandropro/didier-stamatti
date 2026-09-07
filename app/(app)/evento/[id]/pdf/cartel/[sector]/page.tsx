import { getSessionUser } from "@/lib/auth";
import { canVerStock } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { fmtEventDate } from "@/lib/format";
import { PrintPlainButton } from "@/components/PrintButton";
import { Cartel } from "@/components/Cartel";
import { CATEGORIES as SECTORS, esCategoria, nombreDeCategoria } from "@/lib/categories";

export const dynamic = "force-dynamic";



export default async function CartelSectorPage({
  params,
}: {
  params: Promise<{ id: string; sector: string }>;
}) {
  // Estas pantallas son del stock. La sesion ya la exige el layout, pero el rol
  // no lo comprobaba nadie: quien recibe mercaderia o quien paga podia escribir
  // la direccion a mano y entrar. No es informacion sensible, pero la regla del
  // proyecto es que cada pantalla comprueba su propio permiso — apoyarse en que
  // "no hay un enlace" es apoyarse en la navegacion, y la navegacion cambia.
  const sesion = await getSessionUser();
  if (!sesion || !canVerStock(sesion.role)) notFound();
  const { id, sector: sectorParam } = await params;
  const sector = sectorParam.toUpperCase();
  if (!esCategoria(sector)) notFound();

  const ev = await prisma.event.findUnique({ where: { id } });
  if (!ev || ev.deletedAt) notFound();

  return (
    <>
      <div className="topbar no-print">
        <div>
          <h1>Cartel — {nombreDeCategoria(sector)}</h1>
          <div className="sub">{ev.lugar} · para reimprimir las veces que haga falta</div>
        </div>
        <div className="spacer" />
        <Link className="btn ghost" href={`/evento/${ev.id}/pdf`}>Volver al pedido</Link>
        <PrintPlainButton />
      </div>

      <div className="content pdf-content">
        <Cartel sector={sector} lugar={ev.lugar} dateLabel={fmtEventDate(ev.date)} />
      </div>
    </>
  );
}
