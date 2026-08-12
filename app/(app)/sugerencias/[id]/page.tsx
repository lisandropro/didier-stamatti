import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canSendSuggestions, canManageSuggestions } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/format";
import { KIND_LABEL, STATUS_LABEL, STATUS_CLASS, screenLabel } from "@/lib/suggestions";
import { SuggestionAdmin } from "@/components/SuggestionAdmin";

export const dynamic = "force-dynamic";

export default async function SugerenciaPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canSendSuggestions(user.role)) redirect("/");

  const { id } = await params;
  const s = await prisma.suggestion.findUnique({ where: { id } });
  const admin = canManageSuggestions(user.role);

  // Quien no administra solo puede abrir las suyas. Se responde "no existe" y no
  // "no podés": así no se puede averiguar qué sugerencias hay probando ids.
  if (!s || (!admin && s.authorId !== user.id)) notFound();

  const evento = s.eventId
    ? await prisma.event.findUnique({ where: { id: s.eventId }, select: { lugar: true, deletedAt: true } })
    : null;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{s.title}</h1>
          <div className="sub">
            {KIND_LABEL[s.kind] ?? s.kind} · {s.authorName} · {fmtDateTime(s.createdAt)}
          </div>
        </div>
        <div className="spacer" />
        <span className={`chip ${STATUS_CLASS[s.status] ?? "neutral"}`}>
          {STATUS_LABEL[s.status] ?? s.status}
        </span>
        {/* Quien no gestiona no tiene bandeja: su "volver" es el inicio, no una
            lista que lo rebotaría. Llega acá desde el aviso de la respuesta. */}
        <Link className="btn ghost" href={admin ? "/sugerencias" : "/"}>
          Volver
        </Link>
      </div>

      <div className="content">
        <section className="sug-block">
          <div className="section-title">Qué dice</div>
          <p className="sug-body">{s.body}</p>
        </section>

        {s.reply ? (
          <section className="sug-block sug-reply">
            <div className="section-title">Respuesta</div>
            <p className="sug-body">{s.reply}</p>
            <p className="sug-meta">
              {s.repliedByName ?? "La administradora"}
              {s.repliedAt ? ` · ${fmtDateTime(s.repliedAt)}` : ""}
            </p>
          </section>
        ) : (
          !admin && (
            <section className="sug-block">
              <p className="sug-meta">Todavía sin responder. Cuando la administradora conteste, te avisamos.</p>
            </section>
          )
        )}

        <section className="sug-block">
          <div className="section-title">Contexto</div>
          <dl className="sug-facts">
            <div>
              <dt>Pantalla</dt>
              <dd>{screenLabel(s.screen ?? "")}</dd>
            </div>
            {evento && (
              <div>
                <dt>Evento</dt>
                <dd>
                  {evento.deletedAt ? (
                    `${evento.lugar} (en la papelera)`
                  ) : (
                    <Link href={`/evento/${s.eventId}`}>{evento.lugar}</Link>
                  )}
                </dd>
              </div>
            )}
            {s.contextNote && (
              <div>
                <dt>Sobre</dt>
                <dd>{s.contextNote}</dd>
              </div>
            )}
            <div>
              <dt>Enviada</dt>
              <dd>{fmtDateTime(s.createdAt)}</dd>
            </div>
            {admin && (
              <>
                <div>
                  <dt>Dispositivo</dt>
                  <dd>{s.device ?? "—"}</dd>
                </div>
                <div>
                  <dt>Versión</dt>
                  <dd>{s.appVersion ?? "—"}</dd>
                </div>
              </>
            )}
          </dl>
        </section>

        {admin && (
          <SuggestionAdmin id={s.id} status={s.status} reply={s.reply} />
        )}
      </div>
    </>
  );
}
