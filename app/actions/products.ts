"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export type ProductResult = { ok: boolean; error?: string; id?: string };

const CATEGORIES = ["ENSERES", "MOBILIARIO", "BEBIDA"];
const TYPES = ["REUTILIZABLE", "CONSUMIBLE"];

/** Rubros que ya se usan en cada categoría, para ofrecerlos en vez de que cada
 *  quien invente el suyo: si el rubro se escribe distinto, el producto queda
 *  suelto en el listado y en el pedido impreso. */
export async function listRubros(): Promise<Record<string, string[]>> {
  const rows = await prisma.product.findMany({
    where: { rubro: { not: null } },
    select: { category: true, rubro: true },
    distinct: ["category", "rubro"],
    orderBy: [{ category: "asc" }, { rubro: "asc" }],
  });
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    if (!r.rubro) continue;
    (out[r.category] ??= []).push(r.rubro);
  }
  return out;
}

/** Da de alta un producto nuevo en el catálogo. Solo la administradora. */
export async function createProduct(input: {
  name: string;
  description?: string;
  category: string;
  rubro?: string;
  type: string;
  unit?: string;
  stock?: number;
}): Promise<ProductResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (user.role !== "ADMIN") return { ok: false, error: "Solo la administradora puede agregar productos." };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Poné el nombre del producto." };
  if (!CATEGORIES.includes(input.category)) return { ok: false, error: "Elegí la categoría." };
  if (!TYPES.includes(input.type)) return { ok: false, error: "Elegí si lleva control de stock." };

  // El mismo producto cargado dos veces con distinta grafía es el problema que
  // más cuesta desarmar después: se compara sin acentos ni mayúsculas.
  const normal = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  const existentes = await prisma.product.findMany({ select: { id: true, name: true, active: true } });
  const choque = existentes.find((p) => normal(p.name) === normal(name));
  if (choque) {
    return {
      ok: false,
      error: choque.active
        ? `Ya existe un producto llamado "${choque.name}".`
        : `Ya existe "${choque.name}", pero está desactivado. Volvé a activarlo en vez de crear otro.`,
    };
  }

  // Los consumibles no llevan stock: se compran para cada evento.
  const esReutilizable = input.type === "REUTILIZABLE";
  const stock = esReutilizable ? Math.max(0, Math.round(input.stock ?? 0)) : 0;

  const p = await prisma.product.create({
    data: {
      name,
      description: input.description?.trim() || null,
      category: input.category,
      rubro: input.rubro?.trim() || null,
      type: input.type,
      unit: input.unit?.trim() || "Unidad",
      stock,
      active: true,
    },
  });

  // La cantidad inicial queda explicada en el historial, igual que cualquier
  // otro movimiento: si no, aparece un número sin origen.
  if (stock > 0) {
    await prisma.stockMovement.create({
      data: {
        productId: p.id,
        delta: stock,
        reason: "AJUSTE",
        note: "Alta del producto — cantidad inicial",
        userId: user.id,
      },
    });
  }

  revalidatePath("/inventario");
  revalidatePath("/");
  return { ok: true, id: p.id };
}
