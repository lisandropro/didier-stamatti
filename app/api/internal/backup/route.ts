import { NextRequest, NextResponse } from "next/server";
import { runBackup } from "@/lib/backup";

// Runtime de Node, explícito: esta ruta usa `better-sqlite3` y el SDK de S3,
// que no corren fuera de Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Disparador manual de respaldo, para verificar o forzar uno fuera del horario
// automático. Protegido por un secreto propio (no la sesión de usuario), para
// poder llamarlo desde afuera de la app si hace falta.
export async function POST(req: NextRequest) {
  const secret = process.env.BACKUP_TRIGGER_SECRET;
  const given = req.headers.get("x-backup-secret");
  if (!secret || !given || given !== secret) {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }
  const res = await runBackup();
  return NextResponse.json(res, { status: res.ok ? 200 : 500 });
}
