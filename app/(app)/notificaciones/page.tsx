import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { NotificationsList } from "@/components/NotificationsList";
import { EnableNotifications } from "@/components/EnableNotifications";

export const dynamic = "force-dynamic";

export default async function NotificacionesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

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
        <EnableNotifications />
        <NotificationsList items={items} />
      </div>
    </>
  );
}
