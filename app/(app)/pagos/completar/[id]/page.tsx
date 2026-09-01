import { redirect, notFound } from "next/navigation";
import { sesionVigente } from "@/lib/auth";
import { canVerImportes } from "@/lib/permissions";
import { prismaComprobantes as db } from "@/lib/db-comprobantes";
import { aTextoPlano } from "@/lib/money";
import FormularioCompletar from "./formulario";

export const metadata = { title: "Completar comprobante" };
export const dynamic = "force-dynamic";

/**
 * Completar a mano lo que no vino leído.
 *
 * **Vive bajo `/pagos` y no bajo `/recepcion`**, aunque el plan la ubicara ahí.
 * Acá se tipea un importe, así que exige `canVerImportes`; colgarla del depósito
 * hubiera dejado a quien recibe mercadería chocándose con un 404 dentro de su
 * propia sección.
 *
 * La foto va **al lado del formulario**, no arriba ni detrás de un botón: así se
 * completa de verdad, mirando el papel y copiando. Cualquier cosa que obligue a
 * alternar entre dos vistas es cómo se tipea un número de la factura de al lado.
 */
export default async function CompletarPage({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await sesionVigente();
  if (!sesion) redirect("/login");
  if (!canVerImportes(sesion.role)) redirect("/");

  const { id } = await params;
  const doc = await db.document.findFirst({
    where: { id, deletedAt: null },
    include: { supplier: { select: { name: true } } },
  });
  if (!doc) notFound();

  // Los nombres que ya existen, para ofrecerlos en vez de que cada quien
  // escriba el suyo. Un proveedor tipeado distinto parte la deuda en dos.
  const proveedores = await db.supplier.findMany({
    where: { deletedAt: null },
    select: { name: true },
    orderBy: { name: "asc" },
  });

  return (
    <FormularioCompletar
      id={doc.id}
      kind={doc.kind}
      yaPagado={doc.pagadoAt !== null}
      tieneFoto={(await db.attachment.count({ where: { documentId: doc.id } })) > 0}
      inicial={{
        nombreProveedor: doc.supplier?.name ?? "",
        // Se muestra en pesos con coma, que es como se va a volver a tipear.
        importe: doc.importeTotal == null ? "" : centavosATexto(doc.importeTotal),
        fechaEmision: doc.fechaEmision ?? "",
        vencimiento: doc.vencimiento ?? "",
      }}
      proveedores={proveedores.map((p) => p.name)}
    />
  );
}

/** `1245080n` -> `"12450,80"`. Sin puntos de miles: se va a editar, no a leer. */
function centavosATexto(centavos: bigint): string {
  const t = aTextoPlano(centavos).padStart(3, "0");
  return `${t.slice(0, -2)},${t.slice(-2)}`;
}
