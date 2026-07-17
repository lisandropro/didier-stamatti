// Reseteo manual de contraseña.
// Uso:  npm run set-password -- <email> <nueva-contraseña>
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  const pass = process.argv[3] ?? "";
  if (!email || !pass) {
    console.error('Uso: npm run set-password -- <email> "<nueva-contraseña>"');
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No existe un usuario con el email ${email}`);
    process.exit(1);
  }
  await prisma.user.update({
    where: { email },
    data: { passwordHash: bcrypt.hashSync(pass, 10) },
  });
  console.log(`Contraseña actualizada para ${email}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
