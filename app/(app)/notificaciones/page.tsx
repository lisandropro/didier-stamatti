import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { NotificationsList } from "@/components/NotificationsList";
import { EnableNotifications } from "@/components/EnableNotifications";
import { ParaRevisar } from "@/components/ParaRevisar";
import { canSeeChecks } from "@/lib/permissions";
import { revisarTodo } from "@/lib/checks";

export const dynamic = "force-dynamic";

export default async function NotificacionesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Los controles de datos son de la administradora: es a quien le toca
  // ocuparse de lo que señalan.
  const hallazgos = canSeeChecks(user.role) ? await revisarTodo() : [];

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
