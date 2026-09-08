import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { NotificationsList } from "@/components/NotificationsList";
import { EnableNotifications } from "@/components/EnableNotifications";
import { ParaRevisar } from "@/components/ParaRevisar";
import { canSeeChecks } from "@/lib/permissions";
import { collectProblems } from "@/lib/healthcheck";

export const dynamic = "force-dynamic";

export default async function NotificacionesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Los controles de datos son de la administradora: es a quien le toca
  // ocuparse de lo que señalan.
  //
  // **Acá va TODO, no solo lo que interrumpe.** Desde que el push lleva
  // únicamente lo urgente, ésta es la única pantalla donde se ve el trabajo
  // pendiente — y es también el primer lugar donde se ve el estado del
  // respaldo, que hasta ahora solo existía dentro de un push: si te perdías ese
  // aviso, ningún lugar de la app decía que estaba roto.
  //
  // Sin la verificación de restauración, que baja decenas de megas y corre una
  // vez por día. Si esa falla, es `alta` y llega por push, que queda en la
  // lista de abajo.
  const hallazgos = canSeeChecks(user.role)
    ? await collectProblems({ verificarRestauracion: false })
    : [];

  const notifs = await prisma.notification.findMany({
    where: { recipientId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const items = notifs.map((n) => ({
    id: n.id,
    message: n.message,
    eventId: n.eventId,
    read: n.read,
    changeCount: n.changeCount,
    linkUrl: n.linkUrl,
    at: n.createdAt.toISOString(),
  }));

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Avisos</h1>
          <div className="sub">Cambios en los pedidos hechos por el equipo</div>
        </div>
      </div>
      <div className="content">
        <ParaRevisar hallazgos={hallazgos} />
        <EnableNotifications />
        <NotificationsList items={items} />
      </div>
    </>
  );
}
