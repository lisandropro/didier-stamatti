import { NextRequest, NextResponse } from "next/server";
import { runBackup } from "@/lib/backup";
import { secretoValido } from "@/lib/secreto";

// Runtime de Node, explícito: esta ruta usa `better-sqlite3` y el SDK de S3,
// que no corren fuera de Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Disparador manual de respaldo, para verificar o forzar uno fuera del horario
// automático. Protegido por un secreto propio (no la sesión de usuario), para
// poder llamarlo desde afuera de la app si hace falta.
//
// El secreto (`BACKUP_TRIGGER_SECRET`) tiene que medir 32 bytes o más: con uno
// más corto, o sin configurar, la ruta no le abre a nadie. Y se compara sin
// que el tiempo de respuesta cuente cuánto se acertó (ver lib/secreto.ts).
export async function POST(req: NextRequest) {
  if (!secretoValido(req.headers.get("x-backup-secret"), process.env.BACKUP_TRIGGER_SECRET)) {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }
  const res = await runBackup();
  return NextResponse.json(res, { status: res.ok ? 200 : 500 });
}
