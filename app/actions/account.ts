"use server";

import { prisma } from "@/lib/db";
import { getSessionUser, renovarSesion } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { hashearClave, problemaDeClave } from "@/lib/clave";
import { mismoNombre } from "@/lib/nombre-de-persona";

export type ChangePwResult = { ok: boolean; error?: string };

/** Cambia el nombre que se muestra en el menú. */
export async function updateName(name: string): Promise<ChangePwResult> {
  const session = await getSessionUser();
  if (!session) return { ok: false, error: "Tenés que iniciar sesión." };

  if (typeof name !== "string") return { ok: false, error: "El nombre no puede quedar vacío." };
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return { ok: false, error: "El nombre no puede quedar vacío." };
  if (clean.length > 40) return { ok: false, error: "El nombre es demasiado largo (máximo 40)." };

  // Los avisos y el historial dicen quién hizo cada cosa por el nombre. Dos
  // personas con el mismo nombre no se distinguen, y cualquiera podría pasar
  // por otra con solo cambiárselo.
  const otros = await prisma.user.findMany({ where: { id: { not: session.id } }, select: { name: true } });
  if (otros.some((o) => mismoNombre(o.name, clean))) {
    return { ok: false, error: "Ya hay otra persona con ese nombre. Agregale el apellido o una inicial." };
  }

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

  const actual = input?.current;
  const next = input?.next;
  if (typeof actual !== "string" || typeof next !== "string" || actual.length > 256) {
    return { ok: false, error: "La contraseña actual no es correcta." };
  }

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return { ok: false, error: "No se encontró tu usuario." };

  if (!(await bcrypt.compare(actual, user.passwordHash))) {
    return { ok: false, error: "La contraseña actual no es correcta." };
  }

  const problema = problemaDeClave(next, user);
  if (problema) return { ok: false, error: problema };
  if (next !== input.confirm) {
    return { ok: false, error: "Las contraseñas nuevas no coinciden." };
  }
  if (next === actual) {
    return { ok: false, error: "La contraseña nueva tiene que ser distinta a la actual." };
  }

  const passwordHash = await hashearClave(next);
  // Cambiar la contraseña cierra las sesiones abiertas en todos lados (la
  // sesión va atada a la contraseña). Los teléfonos anotados para los avisos
  // se desanotan en el mismo acto: quien cambia la clave porque perdió el
  // teléfono no quiere que ese teléfono siga recibiendo los avisos. El que se
  // sigue usando se vuelve a anotar solo al abrir la app.
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.pushSubscription.deleteMany({ where: { userId: user.id } }),
  ]);
  // Esta sesión, la de quien acaba de demostrar que sabe las dos contraseñas,
  // sigue: se vuelve a firmar con la contraseña nueva. Sin esto la pantalla
  // decía "listo" y el toque siguiente mandaba al ingreso.
  await renovarSesion({ ...session, passwordHash });
  return { ok: true };
}
