"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";

export type ChangePwResult = { ok: boolean; error?: string };

/** Cambia el nombre que se muestra en el menú. */
export async function updateName(name: string): Promise<ChangePwResult> {
  const session = await getSessionUser();
  if (!session) return { ok: false, error: "Tenés que iniciar sesión." };

  const clean = name.trim();
  if (!clean) return { ok: false, error: "El nombre no puede quedar vacío." };
  if (clean.length > 40) return { ok: false, error: "El nombre es demasiado largo (máximo 40)." };

  await prisma.user.update({ where: { id: session.id }, data: { name: clean } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function changePassword(input: {
  current: string;
  next: string;
  confirm: string;
}): Promise<ChangePwResult> {
  const session = await getSessionUser();
  if (!session) return { ok: false, error: "Tenés que iniciar sesión." };

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return { ok: false, error: "No se encontró tu usuario." };

  if (!bcrypt.compareSync(input.current, user.passwordHash)) {
    return { ok: false, error: "La contraseña actual no es correcta." };
  }

  const next = input.next ?? "";
  if (next.length < 6) {
    return { ok: false, error: "La contraseña nueva debe tener al menos 6 caracteres." };
  }
  if (next !== input.confirm) {
    return { ok: false, error: "Las contraseñas nuevas no coinciden." };
  }
  if (next === input.current) {
    return { ok: false, error: "La contraseña nueva tiene que ser distinta a la actual." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: bcrypt.hashSync(next, 10) },
  });
  return { ok: true };
}
