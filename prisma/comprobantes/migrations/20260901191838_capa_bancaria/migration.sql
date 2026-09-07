-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "banco" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "cbu" TEXT,
    "moneda" TEXT NOT NULL DEFAULT 'ARS',
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BankMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "fechaContable" TEXT NOT NULL,
    "fechaValor" TEXT,
    "descripcion" TEXT NOT NULL,
    "referencia" TEXT,
    "importe" BIGINT NOT NULL,
    "saldoPosterior" BIGINT,
    "idExterno" TEXT,
    "huella" TEXT NOT NULL,
    "origen" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "categoria" TEXT,
    "importadoAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankMovement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BankImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "origen" TEXT NOT NULL,
    "archivo" TEXT NOT NULL,
    "hashArchivo" TEXT NOT NULL,
    "filasLeidas" INTEGER NOT NULL,
    "filasNuevas" INTEGER NOT NULL,
    "filasRepetidas" INTEGER NOT NULL,
    "desde" TEXT,
    "hasta" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_banco_alias_key" ON "BankAccount"("banco", "alias");

-- CreateIndex
CREATE UNIQUE INDEX "BankMovement_huella_key" ON "BankMovement"("huella");

-- CreateIndex
CREATE INDEX "BankMovement_accountId_fechaContable_idx" ON "BankMovement"("accountId", "fechaContable");

-- CreateIndex
CREATE INDEX "BankMovement_estado_idx" ON "BankMovement"("estado");

-- CreateIndex
CREATE INDEX "BankMovement_loteId_idx" ON "BankMovement"("loteId");

-- CreateIndex
CREATE INDEX "BankImport_accountId_createdAt_idx" ON "BankImport"("accountId", "createdAt");
