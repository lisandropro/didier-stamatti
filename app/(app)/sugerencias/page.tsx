import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canManageSuggestions } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/format";
import { isKind, isStatus } from "@/lib/suggestions";
import { SuggestionsList } from "@/components/SuggestionsList";

export const dynamic = "force-dynamic";

export default async function SugerenciasPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; estado?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // La bandeja es de quien las gestiona. Los demás mandan sugerencias con el
  // botón y leen la respuesta desde el aviso que les llega, sin una sección que
  // atender.
  if (!canManageSuggestions(user.role)) redirect("/");

  const sp = await searchParams;
  const tipo = sp.tipo && isKind(sp.tipo.toUpperCase()) ? sp.tipo.toUpperCase() : null;
  const estado = sp.estado && isStatus(sp.estado.toUpperCase()) ? sp.estado.toUpperCase() : null;

  const sugerencias = await prisma.suggestion.findMany({
    where: {
      ...(tipo ? { kind: tipo } : {}),
      ...(estado ? { status: estado } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const items = sugerencias.map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    status: s.status,
    authorName: s.authorName,
    eventLugar: s.eventLugar,
    tieneRespuesta: Boolean(s.reply),
    at: fmtDateTime(s.createdAt),
  }));

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Sugerencias</h1>
          <div className="sub">Lo que el equipo propone o reporta sobre la app</div>
        </div>
      </div>
      <div className="content">
        <SuggestionsList items={items} tipo={tipo} estado={estado} />
      </div>
    </>
  );
}
