"use server";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/email";
import bcrypt from "bcryptjs";
import { createSession, destroySession } from "@/lib/auth";
import { redirect } from "next/navigation";

export type LoginState = { error?: string };

export async function login(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  // Se normaliza igual que al crear el usuario: si el teclado compuso el acento
  // de otra forma, el texto igual tiene que llegar al mismo lugar.
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const remember = formData.get("remember") === "on";

  if (!email || !password) {
    return { error: "Completá el email y la contraseña." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return { error: "Email o contraseña incorrectos." };
  }

  await createSession(
    { id: user.id, name: user.name, role: user.role, email: user.email },
    remember
  );
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
