import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canSendSuggestions, canManageSuggestions } from "@/lib/permissions";
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
  // Quien no participa del canal no tiene nada que ver acá.
  if (!canSendSuggestions(user.role)) redirect("/");

  const admin = canManageSuggestions(user.role);
  const sp = await searchParams;
  const tipo = sp.tipo && isKind(sp.tipo.toUpperCase()) ? sp.tipo.toUpperCase() : null;
  const estado = sp.estado && isStatus(sp.estado.toUpperCase()) ? sp.estado.toUpperCase() : null;

  const sugerencias = await prisma.suggestion.findMany({
    where: {
      // La administradora ve todas; el resto, solo las propias. El filtro es del
      // servidor: no alcanza con no mostrar el resto en la pantalla.
      ...(admin ? {} : { authorId: user.id }),
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
          <h1>{admin ? "Sugerencias" : "Mis sugerencias"}</h1>
          <div className="sub">
            {admin
              ? "Lo que el equipo propone o reporta sobre la app"
              : "Lo que enviaste y qué contestó la administradora"}
          </div>
        </div>
      </div>
      <div className="content">
        <SuggestionsList items={items} admin={admin} tipo={tipo} estado={estado} />
      </div>
    </>
  );
}
