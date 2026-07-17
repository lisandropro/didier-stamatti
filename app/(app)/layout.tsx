import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Sidebar } from "@/components/Sidebar";
import { MobileNav } from "@/components/MobileNav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/login");

  // El nombre se lee de la base (no de la sesión) para que un cambio en
  // Ajustes se vea al instante, sin tener que volver a iniciar sesión.
  const fresh = await prisma.user.findUnique({
    where: { id: session.id },
    select: { name: true, role: true },
  });
  const user = { name: fresh?.name ?? session.name, role: fresh?.role ?? session.role };

  return (
    <div className="app">
      <Sidebar user={user} />
      <div className="main">{children}</div>
      <MobileNav />
    </div>
  );
}
