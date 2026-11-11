import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { LoginForm } from "@/components/LoginForm";

export const metadata = { title: "Ingresar" };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");
  return <LoginForm />;
}
