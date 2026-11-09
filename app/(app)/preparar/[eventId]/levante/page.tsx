import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canEditStock, canPreparar, canVerPreparacion } from "@/lib/permissions";
import { levanteDelEvento } from "@/lib/levante-db";
import { bajaDe, etiquetaDeMotivo } from "@/lib/levante";
import { diaDe, fmtEvento, fmtMomento, hoy } from "@/lib/dates";
import { Levante } from "@/components/Levante";

export const dynamic = "force-dynamic";

export default async function LevantePage({ params }: { params: Promise<{ eventId: string }> }) {
  // Como Preparar: la pantalla comprueba su propio permiso.
  const sesion = await getSessionUser();
  if (!sesion || !canVerPreparacion(sesion.role)) notFound();

  const { eventId } = await params;
  const ev = await prisma.event.findFirst({
    where: { id: eventId, deletedAt: null, period: { deletedAt: null } },
    select: { id: true, lugar: true, date: true, levanteAt: true, levantePorName: true },
  });
  if (!ev) notFound();

  const items = await levanteDelEvento(ev.id);
  const terminado = ev.levanteAt
    ? { por: `${ev.levantePorName ?? "Alguien"} · ${fmtMomento(ev.levanteAt)}` }
    : null;

  // Si un faltante se puede descontar lo decide el producto como está ahora
  // (`bajaDe`, la misma regla que aplica la acción). Se lee solo si quien mira
  // puede descontar y el levante está terminado, y solo para los faltantes.
  const puedeDescontar = terminado !== null && canEditStock(sesion.role);
  const aDescontar = puedeDescontar ? items.filter((i) => i.estado === "FALTA" && !i.descontado) : [];
  const productos = new Map(
    (aDescontar.length === 0
      ? []
      : await prisma.product.findMany({ where: { id: { in: aDescontar.map((i) => i.clave) } }, select: { id: true, type: true, stock: true } })
    ).map((p) => [p.id, p]),
  );

  return (
    <Levante
      data={{
        evento: { id: ev.id, lugar: ev.lugar, cuando: fmtEvento(ev.date), esHoy: diaDe(ev.date) === hoy() },
        items: items.map((i) => ({
          clave: i.clave,
          itemName: i.itemName,
          unit: i.unit,
          category: i.category,
          qty: i.qty,
          note: i.note,
          estado: i.estado,
          faltan: i.faltan,
          marcadoPor: i.marca ? `${i.marca.porName} · ${fmtMomento(i.marca.at)}` : null,
          descontado: i.descontado ? etiquetaDeMotivo(i.descontado.motivo) : null,
          baja: aDescontar.includes(i) ? bajaDe(i.clave, productos.get(i.clave) ?? null) : null,
        })),
        terminado,
        // Terminado, nadie marca: para corregir, la administradora lo reabre.
        puedeMarcar: canPreparar(sesion.role) && !terminado,
        puedeAjustarStock: canEditStock(sesion.role),
      }}
    />
  );
}
