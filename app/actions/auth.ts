"use server";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/email";
import bcrypt from "bcryptjs";
import { loginLimiter } from "@/lib/login-limit";
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

  if (email.length > 254 || password.length > 256) return { error: "Email o contraseña incorrectos." };
  if (!loginLimiter.take(email)) return { error: "Demasiados intentos. Esperá 15 minutos antes de volver a intentar." };
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return { error: "Email o contraseña incorrectos." };
  }

  loginLimiter.clear(email);
  await createSession(
    user,
    remember
  );
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
