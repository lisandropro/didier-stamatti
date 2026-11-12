import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { MobileNav } from "@/components/MobileNav";
import { PushSubscriptionSync } from "@/components/PushSubscriptionSync";
import { SuggestionBox } from "@/components/SuggestionBox";
import { Actualizador } from "@/components/Actualizador";
import { SinConexion } from "@/components/SinConexion";
import { TirarParaActualizar } from "@/components/TirarParaActualizar";
import { appVersion } from "@/lib/app-version";
import { Pantalla } from "@/components/Pantalla";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/login");

  const user = { name: session.name, role: session.role };

  return (
    <div className="app">
      {/* Avisa arriba si el teléfono se queda sin señal (en el depósito va y
          viene) y, al volver, vuelve a pedir la pantalla. */}
      <SinConexion />
      {/* Tirar hacia abajo para actualizar, solo en Período, Preparar y Avisos:
          en el editor del pedido hay cantidades sin guardar. Inactivo no dibuja
          nada, así no ocupa un lugar en la grilla. */}
      <TirarParaActualizar />
      {/* Se pasa la versión con la que se dibujó esta pantalla: si el servidor
          pasa a otra, la app se actualiza sola en cuanto nadie esté a mitad de
          algo. Sin esto, una pestaña vieja falla al guardar y no avisa. */}
      <Actualizador version={appVersion()} />
      {/* La suscripción push es del teléfono, no de la persona: al abrir la app
          se vuelve a anotar a nombre de quien tiene la sesión ahora. */}
      <PushSubscriptionSync />
      <Sidebar user={user} />
      {/* <main>: el lector de pantalla puede saltar directo al contenido. */}
      <main className="main">
        <Pantalla>{children}</Pantalla>
      </main>
      <MobileNav role={user.role} />
      {/* El formulario vive una sola vez acá: se abre desde cualquier pantalla. */}
      <SuggestionBox />
    </div>
  );
}
