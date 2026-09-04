import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Sidebar } from "@/components/Sidebar";
import { MobileNav } from "@/components/MobileNav";
import { PushSubscriptionSync } from "@/components/PushSubscriptionSync";
import { SuggestionBox } from "@/components/SuggestionBox";
import { Actualizador } from "@/components/Actualizador";
import { appVersion } from "@/lib/app-version";

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
      {/* Se pasa la versión con la que se dibujó esta pantalla: si el servidor
          pasa a otra, la app se actualiza sola en cuanto nadie esté a mitad de
          algo. Sin esto, una pestaña vieja falla al guardar y no avisa. */}
      <Actualizador version={appVersion()} />
      {/* La suscripción push es del teléfono, no de la persona: al abrir la app
          se vuelve a anotar a nombre de quien tiene la sesión ahora. */}
      <PushSubscriptionSync />
      <Sidebar user={user} />
      <div className="main">{children}</div>
      <MobileNav role={user.role} />
      {/* El formulario vive una sola vez acá: se abre desde cualquier pantalla. */}
      <SuggestionBox />
    </div>
  );
}
