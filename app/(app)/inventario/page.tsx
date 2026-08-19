import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { InventoryTable } from "@/components/InventoryTable";
import { ordenDeCategoria } from "@/lib/categories";

export const dynamic = "force-dynamic";

export default async function InventarioPage() {
  const session = await getSessionUser();
  const canEdit = session?.role === "ADMIN"; // solo la administradora edita stock

  const products = await prisma.product.findMany({
    orderBy: [{ rubro: "asc" }, { name: "asc" }],
  });
  // sort estable por categoría, conservando rubro/nombre dentro de cada una
  products.sort((a, b) => ordenDeCategoria(a.category) - ordenDeCategoria(b.category));

  const reutCount = products.filter((p) => p.type === "REUTILIZABLE").length;
  const bajaCount = products.filter((p) => !p.active).length;

  const data = products.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    rubro: p.rubro,
    type: p.type,
    unit: p.unit,
    stock: p.stock,
    active: p.active,
  }));

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Inventario</h1>
          <div className="sub">
            {products.length} productos · {reutCount} con control de stock
            {bajaCount > 0 ? ` · ${bajaCount} dado${bajaCount === 1 ? "" : "s"} de baja` : ""}
          </div>
        </div>
      </div>
      <div className="content">
        <InventoryTable products={data} canEdit={canEdit} />
      </div>
    </>
  );
}
