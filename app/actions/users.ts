"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";

export type UserResult = { ok: boolean; error?: string; id?: string };

const ROLES = ["ADMIN", "ARMADOR"];

async function requireAdmin() {
  const session = await getSessionUser();
  if (!session) return { session: null, error: "Tenés que iniciar sesión." };
  if (session.role !== "ADMIN") return { session: null, error: "Solo la administradora puede gestionar usuarios." };
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

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const role = input.role;

  if (!name) return { ok: false, error: "Poné el nombre." };
  if (!email || !email.includes("@")) return { ok: false, error: "Poné un email válido." };
  if (!ROLES.includes(role)) return { ok: false, error: "Elegí el rol." };
  if (input.password.length < 6) return { ok: false, error: "La contraseña debe tener al menos 6 caracteres." };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { ok: false, error: "Ya existe un usuario con ese email." };

  const user = await prisma.user.create({
    data: { name, email, role, passwordHash: bcrypt.hashSync(input.password, 10) },
  });
  revalidatePath("/usuarios");
  return { ok: true, id: user.id };
}

/** Le pone una nueva contraseña temporal a un usuario (para cuando se la olvida). */
export async function resetUserPassword(userId: string, newPassword: string): Promise<UserResult> {
  const { session, error } = await requireAdmin();
  if (!session) return { ok: false, error: error! };
  if (newPassword.length < 6) return { ok: false, error: "La contraseña debe tener al menos 6 caracteres." };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "No se encontró el usuario." };

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: bcrypt.hashSync(newPassword, 10) },
  });
  revalidatePath("/usuarios");
  return { ok: true };
}

/** Cambia el rol de un usuario, sin dejar al sistema sin ninguna administradora. */
export async function setUserRole(userId: string, role: string): Promise<UserResult> {
  const { session, error } = await requireAdmin();
  if (!session) return { ok: false, error: error! };
  if (!ROLES.includes(role)) return { ok: false, error: "Rol inválido." };

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

  if (userId === session.id) return { ok: false, error: "No podés borrar tu propio usuario." };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "No se encontró el usuario." };

  if (user.role === "ADMIN") {
    const admins = await prisma.user.count({ where: { role: "ADMIN" } });
    if (admins <= 1) return { ok: false, error: "Tiene que quedar al menos una administradora." };
  }

  // Los movimientos de stock guardan quién los hizo; al borrar el usuario,
  // se desvinculan (quedan en el historial sin nombre) en vez de bloquear el borrado.
  await prisma.$transaction([
    prisma.stockMovement.updateMany({ where: { userId }, data: { userId: null } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
  revalidatePath("/usuarios");
  return { ok: true };
}
