"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/email";
import { claveCorrecta } from "@/lib/clave";
import { direccionDe, limiteDeIngreso } from "@/lib/login-limit";
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
  const direccion = direccionDe(await headers());
  if (!limiteDeIngreso.permitir(email, direccion)) {
    return { error: "Demasiados intentos. Esperá 15 minutos antes de volver a intentar." };
  }
  const user = await prisma.user.findUnique({ where: { email } });
  // Se compara siempre, exista o no la cuenta: si no, la respuesta de un correo
  // sin cuenta llega mucho antes y por el reloj se sabe quién tiene usuario.
  if (!(await claveCorrecta(password, user?.passwordHash)) || !user) {
    return { error: "Email o contraseña incorrectos." };
  }

  limiteDeIngreso.ingresoCorrecto(email, direccion);
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
