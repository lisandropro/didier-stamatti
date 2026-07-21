import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { ProfileCard } from "@/components/ProfileCard";
import { AppearanceCard } from "@/components/AppearanceCard";
import { AccountForm } from "@/components/AccountForm";

export const dynamic = "force-dynamic";

export default async function CuentaPage() {
  const session = await getSessionUser();
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { name: true, email: true },
  });

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Mi cuenta</h1>
          <div className="sub">Ajustes de accesibilidad, personalización y seguridad</div>
        </div>
      </div>
      <div className="content settings-grid">
        <ProfileCard name={user?.name ?? session.name} email={user?.email ?? session.email} />
        <AppearanceCard />
        <AccountForm />
        {session.role === "ADMIN" && (
          <div className="settings-card">
            <h2>Usuarios</h2>
            <p className="settings-sub">Agregá o quitá personas y restablecé contraseñas.</p>
            <Link className="btn primary" href="/usuarios">Gestionar usuarios</Link>
          </div>
        )}
      </div>
    </>
  );
}
