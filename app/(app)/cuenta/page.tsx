import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { ProfileCard } from "@/components/ProfileCard";
import { AppearanceCard } from "@/components/AppearanceCard";
import { AccountForm } from "@/components/AccountForm";
import { logout } from "@/app/actions/auth";

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
        {/* En el celular el menú lateral no existe, y con él quedaba escondida
            la única salida: no había forma de cerrar sesión desde el teléfono. */}
        <div className="settings-card">
          <h2>Cerrar sesión</h2>
          <p className="settings-sub">
            Salís de la app en este dispositivo. Para volver a entrar vas a necesitar tu contraseña.
          </p>
          <form action={logout}>
            <button type="submit" className="btn btn-del">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M15 12H4M8 8l-4 4 4 4" />
                <path d="M11 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
              </svg>
              Cerrar sesión
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
