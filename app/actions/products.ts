"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export type ProductResult = { ok: boolean; error?: string; id?: string };

import { esCategoria } from "@/lib/categories";
const TYPES = ["REUTILIZABLE", "CONSUMIBLE"];

/** Compara nombres sin acentos ni mayúsculas: el mismo producto cargado dos
 *  veces con distinta grafía es el problema que más cuesta desarmar después. */
const normal = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** Todas las acciones del catálogo pasan por acá. El permiso se valida en el
 *  servidor: esconder el botón en la pantalla no protege nada. */
async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Tenés que iniciar sesión." };
  if (user.role !== "ADMIN") return { user: null, error: "Solo la administradora puede administrar el catálogo." };
  return { user, error: null };
}

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
  const { user, error: permiso } = await requireAdmin();
  if (!user) return { ok: false, error: permiso! };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Poné el nombre del producto." };
  if (!esCategoria(input.category)) return { ok: false, error: "Elegí la categoría." };
  if (!TYPES.includes(input.type)) return { ok: false, error: "Elegí si lleva control de stock." };

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

const LABEL: Record<string, string> = {
  name: "Nombre",
  description: "Descripción",
  category: "Categoría",
  rubro: "Rubro",
  type: "Control de stock",
  unit: "Unidad",
  active: "Estado",
};

/** Edita los datos de un producto. Cada campo que cambia queda registrado con
 *  quién lo cambió y sus valores anterior y nuevo.
 *
 *  Renombrar es seguro para los pedidos: `OrderLine` apunta al producto por id,
 *  no por nombre, así que ningún pedido pierde su vínculo. Lo que sí cambia es
 *  cómo se ve al reimprimir un pedido viejo — por eso se avisa antes. */
export async function updateProduct(input: {
  id: string;
  name: string;
  description?: string | null;
  category: string;
  rubro?: string | null;
  type: string;
  unit: string;
}): Promise<ProductResult> {
  const { user, error: permiso } = await requireAdmin();
  if (!user) return { ok: false, error: permiso! };

  const p = await prisma.product.findUnique({ where: { id: input.id } });
  if (!p) return { ok: false, error: "No se encontró el producto." };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "El nombre no puede quedar vacío." };
  if (!esCategoria(input.category)) return { ok: false, error: "Elegí la categoría." };
  if (!TYPES.includes(input.type)) return { ok: false, error: "Elegí si lleva control de stock." };

  if (normal(name) !== normal(p.name)) {
    const otros = await prisma.product.findMany({
      where: { id: { not: p.id } },
      select: { name: true, active: true },
    });
    const choque = otros.find((o) => normal(o.name) === normal(name));
    if (choque) {
      return {
        ok: false,
        error: choque.active
          ? `Ya existe otro producto llamado "${choque.name}".`
          : `Ya existe "${choque.name}" (desactivado). Reactivalo en vez de duplicarlo.`,
      };
    }
  }

  const nuevos = {
    name,
    description: input.description?.trim() || null,
    category: input.category,
    rubro: input.rubro?.trim() || null,
    type: input.type,
    unit: input.unit.trim() || "Unidad",
  };

  const campos = Object.keys(nuevos) as (keyof typeof nuevos)[];
  const cambios = campos
    .filter((k) => (p[k] ?? null) !== (nuevos[k] ?? null))
    .map((k) => ({
      productId: p.id,
      actorId: user.id,
      actorName: user.name,
      field: k as string,
      before: p[k] == null ? null : String(p[k]),
      after: nuevos[k] == null ? null : String(nuevos[k]),
    }));

  if (cambios.length === 0) return { ok: true, id: p.id };

  // El stock NO se toca al cambiar de tipo: si pasa a consumible deja de
  // contarse, y si vuelve a reutilizable la cantidad sigue estando. Pisarlo acá
  // sería perder el conteo sin dejar un movimiento que lo explique.
  await prisma.$transaction([
    prisma.product.update({ where: { id: p.id }, data: nuevos }),
    prisma.productChange.createMany({ data: cambios }),
  ]);

  revalidatePath("/inventario");
  revalidatePath("/");
  return { ok: true, id: p.id };
}

/** Desactiva o reactiva un producto. Desactivado deja de ofrecerse al armar
 *  pedidos, pero conserva su stock, su historial y sus pedidos anteriores. */
export async function setProductActive(id: string, active: boolean): Promise<ProductResult> {
  const { user, error: permiso } = await requireAdmin();
  if (!user) return { ok: false, error: permiso! };

  const p = await prisma.product.findUnique({ where: { id }, select: { id: true, active: true } });
  if (!p) return { ok: false, error: "No se encontró el producto." };
  if (p.active === active) return { ok: true, id };

  await prisma.$transaction([
    prisma.product.update({ where: { id }, data: { active } }),
    prisma.productChange.create({
      data: {
        productId: id,
        actorId: user.id,
        actorName: user.name,
        field: "active",
        before: p.active ? "activo" : "desactivado",
        after: active ? "activo" : "desactivado",
      },
    }),
  ]);

  revalidatePath("/inventario");
  revalidatePath("/");
  return { ok: true, id };
}

export type DeleteProductResult = ProductResult & {
  baja?: "logica" | "fisica";
  pedidos?: number;
  movimientos?: number;
};

/** Elimina un producto. Si tiene pedidos o movimientos asociados NO se borra
 *  físicamente —eso rompería pedidos y el historial de stock— sino que se da de
 *  baja lógica. Solo se borra de verdad lo que nunca se usó. */
export async function deleteProduct(id: string): Promise<DeleteProductResult> {
  const { user, error: permiso } = await requireAdmin();
  if (!user) return { ok: false, error: permiso! };

  const p = await prisma.product.findUnique({ where: { id }, select: { id: true, active: true } });
  if (!p) return { ok: false, error: "No se encontró el producto." };

  const [pedidos, movimientos] = await Promise.all([
    prisma.orderLine.count({ where: { productId: id } }),
    prisma.stockMovement.count({ where: { productId: id } }),
  ]);

  if (pedidos > 0 || movimientos > 0) {
    if (p.active) {
      await prisma.$transaction([
        prisma.product.update({ where: { id }, data: { active: false } }),
        prisma.productChange.create({
          data: {
            productId: id,
            actorId: user.id,
            actorName: user.name,
            field: "active",
            before: "activo",
            after: "desactivado",
          },
        }),
      ]);
    }
    revalidatePath("/inventario");
    revalidatePath("/");
    return { ok: true, id, baja: "logica", pedidos, movimientos };
  }

  await prisma.product.delete({ where: { id } });
  revalidatePath("/inventario");
  revalidatePath("/");
  return { ok: true, id, baja: "fisica", pedidos: 0, movimientos: 0 };
}

export type HistoryEntry = {
  id: string;
  at: string;
  actorName: string | null;
  kind: "dato" | "stock";
  label: string;
  before: string | null;
  after: string | null;
  note: string | null;
};

/** Historial completo de un producto: los cambios de sus datos y los de su
 *  cantidad, mezclados en una sola línea de tiempo. */
export async function getProductHistory(id: string): Promise<HistoryEntry[]> {
  const { user } = await requireAdmin();
  if (!user) return [];

  const [cambios, movimientos] = await Promise.all([
    prisma.productChange.findMany({ where: { productId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.stockMovement.findMany({
      where: { productId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { name: true } } },
    }),
  ]);

  const REASON: Record<string, string> = {
    ROTURA: "Rotura",
    PERDIDA: "Pérdida",
    COMPRA: "Compra / ingreso",
    AJUSTE: "Ajuste / conteo",
  };

  const entradas: HistoryEntry[] = [
    ...cambios.map((c) => ({
      id: c.id,
      at: c.createdAt.toISOString(),
      actorName: c.actorName,
      kind: "dato" as const,
      label: LABEL[c.field] ?? c.field,
      before: c.before,
      after: c.after,
      note: null,
    })),
    ...movimientos.map((m) => ({
      id: m.id,
      at: m.createdAt.toISOString(),
      actorName: m.user?.name ?? null,
      kind: "stock" as const,
      label: REASON[m.reason] ?? m.reason,
      before: null,
      after: `${m.delta > 0 ? "+" : ""}${m.delta}`,
      note: m.note,
    })),
  ];

  entradas.sort((a, b) => b.at.localeCompare(a.at));
  return entradas.slice(0, 120);
}
