import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * Una base SQLite nueva y descartable, con las mismas migraciones que corren en
 * producción. No toca dev.db ni nada real.
 *
 * Fija `process.env.DATABASE_URL`: `lib/db` crea el cliente al importarse, así
 * que hay que importarlo DESPUÉS de llamar a esto (con `await import`).
 */
export function crearBaseDescartable(nombre: string): { url: string; borrar: () => void } {
  const archivo = path.join(os.tmpdir(), `didier-test-${nombre}-${process.pid}.db`);
  fs.rmSync(archivo, { force: true });
  // Prisma en Windows necesita que el archivo exista antes de migrar.
  fs.writeFileSync(archivo, "");
  const url = `file:${archivo}`;
  process.env.DATABASE_URL = url;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  return {
    url,
    borrar: () => {
      // En Windows el archivo puede seguir tomado un instante: si no se puede
      // borrar, queda en la carpeta temporal y se limpia solo.
      for (const f of [archivo, `${archivo}-wal`, `${archivo}-shm`, `${archivo}-journal`]) {
        try {
          fs.rmSync(f, { force: true });
        } catch {
          /* se lo lleva el sistema */
        }
      }
    },
  };
}
