// Config del SEGUNDO esquema. El primero sigue en `prisma.config.ts` y no se
// toca: `defineConfig` acepta un solo `schema`, así que la única forma de tener
// dos bases es tener dos configs.
//
// Todo comando de Prisma sobre este módulo necesita `--config`:
//   npx prisma migrate dev --config ./prisma-comprobantes.config.ts
//   npx prisma generate    --config ./prisma-comprobantes.config.ts
//
// Sin `--config` el comando corre contra la base del stock, que es exactamente
// lo que esta separación existe para evitar.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/comprobantes/schema.prisma",
  migrations: { path: "prisma/comprobantes/migrations" },
  datasource: { url: process.env["COMPROBANTES_DATABASE_URL"] },
});
