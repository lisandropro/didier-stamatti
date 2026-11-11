import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

/**
 * Una base SQLite nueva y descartable, con las mismas migraciones que corren en
 * producción. No toca dev.db ni nada real.
 *
 * Fija `process.env.DATABASE_URL`: `lib/db` crea el cliente al importarse, así
 * que hay que importarlo DESPUÉS de llamar a esto (con `await import`).
 *
 * Migrar tarda varios segundos, y antes lo pagaba cada archivo de prueba. Ahora
 * se migra UNA vez a una base plantilla y cada prueba recibe una copia: es el
 * mismo resultado (la plantilla la arma `prisma migrate deploy`, igual que en
 * producción) y la suite tarda una fracción.
 */
export function crearBaseDescartable(nombre: string): { url: string; borrar: () => void } {
  const archivo = path.join(os.tmpdir(), `didier-test-${nombre}-${process.pid}.db`);
  for (const f of [archivo, `${archivo}-wal`, `${archivo}-shm`, `${archivo}-journal`]) fs.rmSync(f, { force: true });
  fs.copyFileSync(plantilla(), archivo);
  const url = `file:${archivo}`;
  process.env.DATABASE_URL = url;
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

/** La base ya migrada, lista para copiar. Se arma la primera vez y se reutiliza
 *  mientras las migraciones no cambien: su nombre sale del contenido de ellas. */
function plantilla(): string {
  const destino = path.join(os.tmpdir(), `didier-test-plantilla-${huellaDeLasMigraciones()}.db`);
  if (fs.existsSync(destino)) return destino;

  // Varios archivos de prueba corren a la vez y pueden llegar acá juntos. Cada
  // uno arma la suya con un nombre propio y la renombra al final: renombrar es
  // de un solo paso, así nadie copia una plantilla a medio escribir.
  const propia = `${destino}.${process.pid}.tmp`;
  fs.rmSync(propia, { force: true });
  // Prisma en Windows necesita que el archivo exista antes de migrar.
  fs.writeFileSync(propia, "");
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: `file:${propia}` },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  for (const resto of [`${propia}-wal`, `${propia}-shm`, `${propia}-journal`]) fs.rmSync(resto, { force: true });
  try {
    fs.renameSync(propia, destino);
  } catch {
    // Otro llegó primero (en Windows no se puede pisar un archivo que alguien
    // está copiando). La suya sirve igual: tienen las mismas migraciones.
    if (!fs.existsSync(destino)) return propia;
    fs.rmSync(propia, { force: true });
  }
  return destino;
}

function huellaDeLasMigraciones(): string {
  const carpeta = path.join(import.meta.dirname, "..", "..", "prisma", "migrations");
  const huella = createHash("sha256");
  for (const nombre of fs.readdirSync(carpeta).sort()) {
    const sql = path.join(carpeta, nombre, "migration.sql");
    if (!fs.existsSync(sql)) continue;
    huella.update(nombre);
    huella.update(fs.readFileSync(sql));
  }
  return huella.digest("hex").slice(0, 16);
}
