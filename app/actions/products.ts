"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { stockAlPasarAReutilizable } from "@/lib/stock-al-cambiar-tipo";
import { esCategoria } from "@/lib/categories";
import { validQuantity } from "@/lib/quantity";
import { TOPES, esId, textoOpcional } from "@/lib/entrada";

export type ProductResult = { ok: boolean; error?: string; id?: string };

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

/** El catálogo se ve en el inventario, en la portada (faltantes), en el editor
 *  de cada pedido y en Preparar: un producto renombrado o dado de baja cambia
 *  las cuatro. Es todo el árbol, como hace el ajuste de stock. */
function revalidarCatalogo() {
  revalidatePath("/", "layout");
}

/** Los textos de un producto, comprobados como cualquier dato de afuera: que
 *  sean texto y que no pasen su tope. Devuelve el primer problema, o los
 *  valores ya limpios. La validación es la misma al crear y al editar. */
function datosDeProducto(input: Record<string, unknown>):
  | { ok: false; error: string }
  | { ok: true; name: string | null; description: string | null; category: string; rubro: string | null; type: string; unit: string } {
  const name = textoOpcional(input.name, TOPES.nombre);
  if (!name.ok) return { ok: false, error: `El nombre es demasiado largo (máximo ${TOPES.nombre}).` };
  const description = textoOpcional(input.description, TOPES.descripcion);
  if (!description.ok) return { ok: false, error: `La descripción es demasiado larga (máximo ${TOPES.descripcion}).` };
  if (typeof input.category !== "string" || !esCategoria(input.category)) return { ok: false, error: "Elegí la categoría." };
  if (typeof input.type !== "string" || !TYPES.includes(input.type)) return { ok: false, error: "Elegí si lleva control de stock." };
  const rubro = textoOpcional(input.rubro, TOPES.rubro);
  if (!rubro.ok) return { ok: false, error: `El rubro es demasiado largo (máximo ${TOPES.rubro}).` };
  const unit = textoOpcional(input.unit, TOPES.unidad);
  if (!unit.ok) return { ok: false, error: `La unidad es demasiado larga (máximo ${TOPES.unidad}).` };
  return {
    ok: true,
    name: name.valor,
    description: description.valor,
    category: input.category,
    rubro: rubro.valor,
    type: input.type,
    unit: unit.valor ?? "Unidad",
  };
}

function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** Rubros que ya se usan en cada categoría, para ofrecerlos en vez de que cada
 *  quien invente el suyo: si el rubro se escribe distinto, el producto queda
 *  suelto en el listado y en el pedido impreso. */
export async function listRubros(): Promise<Record<string, string[]>> {
  // Una server action es un endpoint publico: cualquiera con una sesion —o sin
  // ella— puede invocarla directamente, sin pasar por la pantalla que la usa.
  // Esta era la unica del archivo sin comprobar nada, y devolvia el mapa
  // completo de categorias y rubros del catalogo.
  const { error } = await requireAdmin();
  if (error) return {};

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
  /** Omitido o nulo = **todavía no se contó**, que no es lo mismo que cero.
   *  Es el estado en el que nace un producto que se sabe que existe pero que
   *  nadie fue a contar: así no genera faltantes falsos hasta que alguien lo
   *  cuente. Un cero explícito sí es un dato: se contó y no hay. */
  stock?: number | null;
}): Promise<ProductResult> {
  const { user, error: permiso } = await requireAdmin();
  if (!user) return { ok: false, error: permiso! };
  if (!esObjeto(input)) return { ok: false, error: "Poné el nombre del producto." };

  const datos = datosDeProducto(input);
  if (!datos.ok) return { ok: false, error: datos.error };
  const name = datos.name;
  if (!name) return { ok: false, error: "Poné el nombre del producto." };

  // Los consumibles no llevan stock: se compran para cada evento.
  const esReutilizable = datos.type === "REUTILIZABLE";
  const sinContar = input.stock === null || input.stock === undefined;
  let stock: number | null = 0;
  if (esReutilizable && sinContar) stock = null;
  if (esReutilizable && !sinContar) {
    if (typeof input.stock !== "number" || !Number.isFinite(input.stock)) return { ok: false, error: "Ingresá una cantidad entera válida." };
    stock = Math.max(0, Math.round(input.stock));
    if (!validQuantity(stock)) return { ok: false, error: "Ingresá una cantidad entera válida." };
  }

  // El control de nombre repetido, el alta y su movimiento inicial van en una
  // transacción. Antes eran tres pasos sueltos: dos toques a la vez pasaban los
  // dos el control y creaban el producto dos veces (las transacciones van de a
  // una: el segundo ya ve el del primero), y si el proceso se cortaba entre el
  // alta y el movimiento, quedaba una cantidad sin origen en el historial.
  const hecho = await prisma.$transaction(async (tx): Promise<ProductResult> => {
    const existentes = await tx.product.findMany({ select: { id: true, name: true, active: true } });
    const choque = existentes.find((p) => normal(p.name) === normal(name));
    if (choque) {
      return {
        ok: false,
        error: choque.active
          ? `Ya existe un producto llamado "${choque.name}".`
          : `Ya existe "${choque.name}", pero está desactivado. Volvé a activarlo en vez de crear otro.`,
      };
    }

    const p = await tx.product.create({
      data: {
        name,
        description: datos.description,
        category: datos.category,
        rubro: datos.rubro,
        type: datos.type,
        unit: datos.unit,
        stock,
        active: true,
      },
    });

    // La cantidad inicial queda explicada en el historial, igual que cualquier
    // otro movimiento: si no, aparece un número sin origen. Un producto sin
    // contar no genera movimiento: no hubo recuento que registrar.
    if (stock !== null && stock > 0) {
      await tx.stockMovement.create({
        data: {
          productId: p.id,
          delta: stock,
          reason: "AJUSTE",
          note: "Alta del producto — cantidad inicial",
          userId: user.id,
        },
      });
    }
    return { ok: true, id: p.id };
  });
  if (!hecho.ok) return hecho;

  revalidarCatalogo();
  return hecho;
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
  if (!esObjeto(input) || !esId(input.id)) return { ok: false, error: "No se encontró el producto." };

  const datos = datosDeProducto(input);
  if (!datos.ok) return { ok: false, error: datos.error };
  const name = datos.name;
  if (!name) return { ok: false, error: "El nombre no puede quedar vacío." };

  const p = await prisma.product.findUnique({ where: { id: input.id } });
  if (!p) return { ok: false, error: "No se encontró el producto." };

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
    description: datos.description,
    category: datos.category,
    rubro: datos.rubro,
    type: datos.type,
    unit: datos.unit,
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
  // La excepción es el 0 de un consumible que nunca se contó: no es un dato, y
  // como reutilizable inventaría un faltante. Ese pasa a SIN CONTAR. Solo se
  // escribe el stock cuando cambia: escribirlo siempre pisaría un recuento
  // guardado entre la lectura y esta escritura. No hay carrera con `saveStock`
  // mientras el producto es consumible, porque ahí no hay recuento posible
  // (`saveStock` exige reutilizable). Lo que sí podría pasar es que dos
  // ediciones simultáneas del mismo producto, con un recuento en el medio, lo
  // pisen; con un solo administrador no pasa.
  const sinContar: { stock?: null } = {};
  if (p.type === "CONSUMIBLE" && nuevos.type === "REUTILIZABLE") {
    const [movimientos, fueReutilizable] = await Promise.all([
      prisma.stockMovement.count({ where: { productId: p.id } }),
      prisma.productChange.count({ where: { productId: p.id, field: "type", before: "REUTILIZABLE" } }),
    ]);
    const stock = stockAlPasarAReutilizable({
      stock: p.stock,
      tieneMovimientos: movimientos > 0,
      fueReutilizable: fueReutilizable > 0,
    });
    if (stock === null && p.stock !== null) sinContar.stock = null;
  }

  // `updateMany` y mirar cuántas filas tocó: si el producto se eliminó entre la
  // lectura y esta escritura, un `update` por id lanzaba una excepción cruda (y
  // el historial no se puede crear sin producto). Así no se escribe nada y se
  // contesta con un error normal.
  const guardado = await prisma.$transaction(async (tx) => {
    const r = await tx.product.updateMany({ where: { id: p.id }, data: { ...nuevos, ...sinContar } });
    if (r.count !== 1) return false;
    await tx.productChange.createMany({ data: cambios });
    return true;
  });
  if (!guardado) return { ok: false, error: "No se encontró el producto." };

  revalidarCatalogo();
  return { ok: true, id: p.id };
}

/** Desactiva o reactiva un producto. Desactivado deja de ofrecerse al armar
 *  pedidos, pero conserva su stock, su historial y sus pedidos anteriores. */
export async function setProductActive(id: string, active: boolean): Promise<ProductResult> {
  const { user, error: permiso } = await requireAdmin();
  if (!user) return { ok: false, error: permiso! };
  if (!esId(id) || typeof active !== "boolean") return { ok: false, error: "No se encontró el producto." };

  const p = await prisma.product.findUnique({ where: { id }, select: { id: true, active: true } });
  if (!p) return { ok: false, error: "No se encontró el producto." };
  if (p.active === active) return { ok: true, id };

  // La escritura es la que decide: condicionada a que siga en el otro estado.
  // Con dos toques a la vez cambiaba una sola vez pero el historial anotaba dos.
  await prisma.$transaction(async (tx) => {
    const r = await tx.product.updateMany({ where: { id, active: !active }, data: { active } });
    if (r.count !== 1) return;
    await tx.productChange.create({
      data: {
        productId: id,
        actorId: user.id,
        actorName: user.name,
        field: "active",
        before: active ? "desactivado" : "activo",
        after: active ? "activo" : "desactivado",
      },
    });
  });

  revalidarCatalogo();
  return { ok: true, id };
}

export type DeleteProductResult = ProductResult & {
  baja?: "logica" | "fisica";
  pedidos?: number;
  movimientos?: number;
};

/** Elimina un producto. Si tiene pedidos o movimientos asociados NO se borra
 *  físicamente —eso rompería pedidos y el historial de stock— sino que se da de
 *  baja lógica. Solo se borra de verdad lo que nunca se usó.
 *
 *  Contar y decidir van en la misma transacción que el borrado: con los pasos
 *  sueltos, un renglón que entraba al pedido entre la cuenta y el borrado
 *  quedaba apuntando a un producto que ya no existía (un renglón sin nombre). */
export async function deleteProduct(id: string): Promise<DeleteProductResult> {
  const { user, error: permiso } = await requireAdmin();
  if (!user) return { ok: false, error: permiso! };
  if (!esId(id)) return { ok: false, error: "No se encontró el producto." };

  const hecho = await prisma.$transaction(async (tx): Promise<DeleteProductResult> => {
    const p = await tx.product.findUnique({ where: { id }, select: { id: true, active: true } });
    if (!p) return { ok: false, error: "No se encontró el producto." };

    const pedidos = await tx.orderLine.count({ where: { productId: id } });
    const movimientos = await tx.stockMovement.count({ where: { productId: id } });

    if (pedidos > 0 || movimientos > 0) {
      const r = await tx.product.updateMany({ where: { id, active: true }, data: { active: false } });
      if (r.count === 1) {
        await tx.productChange.create({
          data: {
            productId: id,
            actorId: user.id,
            actorName: user.name,
            field: "active",
            before: "activo",
            after: "desactivado",
          },
        });
      }
      return { ok: true, id, baja: "logica", pedidos, movimientos };
    }

    await tx.product.deleteMany({ where: { id } });
    return { ok: true, id, baja: "fisica", pedidos: 0, movimientos: 0 };
  });

  if (hecho.ok) revalidarCatalogo();
  return hecho;
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
  if (!esId(id)) return [];

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
