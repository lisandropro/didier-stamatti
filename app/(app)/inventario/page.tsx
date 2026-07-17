import { prisma } from "@/lib/db";
import { InventoryTable } from "@/components/InventoryTable";

export const dynamic = "force-dynamic";

// Orden de categorías: Enseres, Mobiliario, Bebida
const CAT_ORDER: Record<string, number> = { ENSERES: 0, MOBILIARIO: 1, BEBIDA: 2 };

export default async function InventarioPage() {
  const products = await prisma.product.findMany({
    orderBy: [{ rubro: "asc" }, { name: "asc" }],
  });
  // sort estable por categoría, conservando rubro/nombre dentro de cada una
  products.sort((a, b) => (CAT_ORDER[a.category] ?? 9) - (CAT_ORDER[b.category] ?? 9));

  const reutCount = products.filter((p) => p.type === "REUTILIZABLE").length;

  const data = products.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    rubro: p.rubro,
    type: p.type,
    unit: p.unit,
    stock: p.stock,
  }));

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Inventario</h1>
          <div className="sub">
            {products.length} productos · {reutCount} con control de stock
          </div>
        </div>
      </div>
      <div className="content">
        <InventoryTable products={data} />
      </div>
    </>
  );
}
