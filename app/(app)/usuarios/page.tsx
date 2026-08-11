import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { UsersManager } from "@/components/UsersManager";
import { canManageUsers } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  // Solo la administradora. El resto ni siquiera ve la lista de correos.
  if (!canManageUsers(session.role)) redirect("/");

  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true },
  });

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Usuarios</h1>
          <div className="sub">Quién puede entrar a la app y con qué permisos</div>
        </div>
      </div>
      <div className="content">
        <UsersManager
          users={users}
          meId={session.id}
        />
      </div>
    </>
  );
}
