import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { fmtEventDate } from "@/lib/format";
import { renderOrderPdf, type PdfSection, type PdfLine } from "@/lib/pdf/OrderPdf";
import { CATEGORIES, CATEGORY_LABEL, esCategoria } from "@/lib/categories";
import { nombreDeArchivo, sePuedeDespachar } from "@/lib/order-sections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECTORS = CATEGORIES.map((key) => ({ key, label: CATEGORY_LABEL[key] }));

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const ev = await prisma.event.findUnique({ where: { id } });
  if (!ev || ev.deletedAt) return NextResponse.json({ error: "Evento no encontrado." }, { status: 404 });

  const lines = await prisma.orderLine.findMany({ where: { eventId: id }, include: { product: true } });

  // `?sector=BEBIDA` devuelve una sola hoja, para mandarle a cada uno lo suyo.
  // Sin el parámetro sale el pedido entero, que es como venía funcionando.
  const pedido = lines.map((l) => ({
    categoria: l.product ? l.product.category : (l.customCategory ?? "ENSERES"),
    esDeCatalogo: Boolean(l.product),
  }));
  const sector = new URL(req.url).searchParams.get("sector");
  if (sector !== null) {
    // Un sector vacío no se despacha: una hoja sin renglones le hace creer a
    // quien la recibe que no falta cargar nada.
    if (!esCategoria(sector) || !sePuedeDespachar(pedido, sector)) {
      return NextResponse.json({ error: "Ese sector no tiene nada pedido." }, { status: 404 });
    }
  }

  const sections: PdfSection[] = SECTORS.filter((sec) => sector === null || sec.key === sector).map((sec) => {
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

  const base = nombreDeArchivo(ev.lugar, fmtEventDate(ev.date), sector);
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
