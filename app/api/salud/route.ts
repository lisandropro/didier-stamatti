import { prisma } from "@/lib/db";
import { appVersion } from "@/lib/app-version";

export const dynamic = "force-dynamic";

/**
 * ¿La app está viva y llega a la base?
 *
 * La consulta Railway al desplegar: mientras no conteste 200, la versión nueva
 * no recibe a nadie. Sin esto, un despliegue que arrancaba pero no podía abrir
 * la base quedaba publicado igual.
 *
 * Es pública a propósito (quien pregunta no tiene sesión) y por eso no dice
 * nada del negocio: solo si anda y qué versión es.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(
      { ok: true, version: appVersion() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error(`[salud] la base no contesta: ${e instanceof Error ? e.message : String(e)}`);
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
