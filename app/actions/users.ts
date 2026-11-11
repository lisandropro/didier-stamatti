"use server";

import { prisma } from "@/lib/db";
import { normalizeEmail, emailProblem } from "@/lib/email";
import { getSessionUser, renovarSesion } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { hashearClave, problemaDeClave } from "@/lib/clave";
import { esId, limpiar } from "@/lib/entrada";
import { mismoNombre } from "@/lib/nombre-de-persona";
import { ROLES, canManageUsers } from "@/lib/permissions";

export type UserResult = { ok: boolean; error?: string; id?: string };

async function requireAdmin() {
  const session = await getSessionUser();
  if (!session) return { session: null, error: "Tenés que iniciar sesión." };
  if (!canManageUsers(session.role)) return { session: null, error: "Solo la administradora puede gestionar usuarios." };
  return { session, error: null };
}

/** Crea un nuevo usuario (armador o administradora) con una contraseña temporal. */
export async function createUser(input: {
  name: string;
  email: string;
  role: string;
  password: string;
}): Promise<UserResult> {
  const { session, error } = await requireAdmin();
  if (!session) return { ok: false, error: error! };

  // Lo que llega de la pantalla se comprueba acá: los tipos de arriba dicen lo
  // que manda el formulario, no lo que puede mandar cualquiera con una sesión.
  const name = limpiar(input?.name, 200);
  const role = input?.role;
  if (!name) return { ok: false, error: "Poné el nombre." };
  if (name.length > 40) return { ok: false, error: "El nombre es demasiado largo (máximo 40)." };
  if (typeof input?.email !== "string" || input.email.length > 254) return { ok: false, error: "Poné un email válido, con arroba." };
  const email = normalizeEmail(input.email);
  const problema = emailProblem(email);
  if (problema) return { ok: false, error: problema };
  if (typeof role !== "string" || !(ROLES as readonly string[]).includes(role)) return { ok: false, error: "Elegí el rol." };
  const problemaClave = problemaDeClave(input?.password, { email, name });
  if (problemaClave) return { ok: false, error: problemaClave };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { ok: false, error: "Ya existe un usuario con ese email." };
  // Los avisos y el historial nombran a la gente por el nombre: dos cuentas
  // con el mismo no se distinguirían.
  const otros = await prisma.user.findMany({ select: { name: true } });
  if (otros.some((o) => mismoNombre(o.name, name))) {
    return { ok: false, error: "Ya hay otra persona con ese nombre. Agregale el apellido o una inicial." };
  }

  const user = await prisma.user.create({
    data: { name, email, role, passwordHash: await hashearClave(input.password) },
  });
  revalidatePath("/usuarios");
  return { ok: true, id: user.id };
}

/** Le pone una nueva contraseña temporal a un usuario (para cuando se la olvida). */
export async function resetUserPassword(userId: string, newPassword: string): Promise<UserResult> {
  const { session, error } = await requireAdmin();
  if (!session) return { ok: false, error: error! };
  if (!esId(userId)) return { ok: false, error: "No se encontró el usuario." };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "No se encontró el usuario." };
  const problemaClave = problemaDeClave(newPassword, user);
  if (problemaClave) return { ok: false, error: problemaClave };

  const passwordHash = await hashearClave(newPassword);
  // La contraseña nueva cierra todas las sesiones de esa persona. Sus teléfonos
  // se desanotan de los avisos en el mismo acto: el caso típico de un reseteo
  // es un teléfono perdido, y ese no tiene que seguir recibiendo los nombres
  // de los eventos. El que la persona sigue usando se anota solo al entrar.
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.pushSubscription.deleteMany({ where: { userId } }),
  ]);
  // Si la administradora se la cambió a sí misma por acá, su sesión sigue.
  if (userId === session.id) await renovarSesion({ ...session, passwordHash });
  revalidatePath("/usuarios");
  return { ok: true };
}

/** Cambia el rol de un usuario, sin dejar al sistema sin ninguna administradora. */
export async function setUserRole(userId: string, role: string): Promise<UserResult> {
  const { session, error } = await requireAdmin();
  if (!session) return { ok: false, error: error! };
  if (!esId(userId)) return { ok: false, error: "No se encontró el usuario." };
  if (typeof role !== "string" || !(ROLES as readonly string[]).includes(role)) return { ok: false, error: "Rol inválido." };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "No se encontró el usuario." };
  if (user.role === role) return { ok: true };

  // No permitir quitar la última administradora.
  if (user.role === "ADMIN" && role !== "ADMIN") {
    const admins = await prisma.user.count({ where: { role: "ADMIN" } });
    if (admins <= 1) return { ok: false, error: "Tiene que quedar al menos una administradora." };
  }

  await prisma.user.update({ where: { id: userId }, data: { role } });
  revalidatePath("/usuarios");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Borra un usuario. No permite borrarte a vos misma ni a la última administradora. */
export async function deleteUser(userId: string): Promise<UserResult> {
  const { session, error } = await requireAdmin();
  if (!session) return { ok: false, error: error! };

  if (!esId(userId)) return { ok: false, error: "No se encontró el usuario." };
  if (userId === session.id) return { ok: false, error: "No podés borrar tu propio usuario." };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "No se encontró el usuario." };

  if (user.role === "ADMIN") {
    const admins = await prisma.user.count({ where: { role: "ADMIN" } });
    if (admins <= 1) return { ok: false, error: "Tiene que quedar al menos una administradora." };
  }

  // Los movimientos de stock guardan quién los hizo; al borrar el usuario,
  // se desvinculan (quedan en el historial sin nombre) en vez de bloquear el borrado.
  // Sus dispositivos se van con él: si no, el teléfono de alguien que ya no
  // está seguiría anotado y contando como "dispositivo sin dueño".
  await prisma.$transaction([
    prisma.stockMovement.updateMany({ where: { userId }, data: { userId: null } }),
    prisma.pushSubscription.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
  revalidatePath("/usuarios");
  return { ok: true };
}
