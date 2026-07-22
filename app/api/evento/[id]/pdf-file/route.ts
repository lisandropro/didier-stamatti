import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { fmtEventDate } from "@/lib/format";
import { renderOrderPdf, type PdfSection, type PdfLine } from "@/lib/pdf/OrderPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECTORS: { key: string; label: string }[] = [
  { key: "ENSERES", label: "Enseres" },
  { key: "MOBILIARIO", label: "Mobiliario" },
  { key: "BEBIDA", label: "Bebida" },
];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const ev = await prisma.event.findUnique({ where: { id } });
  if (!ev) return NextResponse.json({ error: "Evento no encontrado." }, { status: 404 });

  const lines = await prisma.orderLine.findMany({ where: { eventId: id }, include: { product: true } });

  const sections: PdfSection[] = SECTORS.map((sec) => {
    const products: PdfLine[] = lines
      .filter((l) => l.product && l.product.category === sec.key)
      .map((l) => ({ name: l.product!.name, unit: l.product!.unit, qty: l.qty, note: l.note, rubro: l.product!.rubro }))
      .sort((a, b) => (a.rubro ?? "").localeCompare(b.rubro ?? "") || a.name.localeCompare(b.name));
    const customs: PdfLine[] = lines
      .filter((l) => !l.productId && (l.customCategory ?? "ENSERES") === sec.key)
      .map((l) => ({ name: l.customName ?? "", unit: l.customUnit, qty: l.qty, note: l.note }));
    return { key: sec.key, label: sec.label, products, customs };
  });

  const buffer = await renderOrderPdf({
    lugar: ev.lugar,
    dateLabel: fmtEventDate(ev.date),
    guests: ev.guests,
    responsable: ev.responsable,
    sections,
  });

  const base = `Pedido - ${ev.lugar} - ${fmtEventDate(ev.date)}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  // Cabecera HTTP = solo ASCII. Se manda un nombre "plano" como respaldo y el
  // nombre real (con acentos) codificado según RFC 5987 (filename*).
  // NFD separa el acento de la letra; luego se descarta todo lo no-ASCII.
  const ascii = base.normalize("NFD").replace(/[^\x20-\x7e]/g, "");
  const encoded = encodeURIComponent(`${base}.pdf`);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${ascii}.pdf"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "no-store",
    },
  });
}
