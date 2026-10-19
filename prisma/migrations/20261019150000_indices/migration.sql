-- Índices para las consultas que ya existen. No cambian ningún dato.
--
-- Hoy las tablas son chicas (141 eventos, 3.931 renglones, 170 movimientos al
-- 18/10/2026) y las consultas andan sin esto. Crecen todas las semanas, y un
-- índice cuesta casi nada en SQLite: se agregan antes de que hagan falta.
--
-- - Event(date): los controles y el aviso de pedido vacío buscan por rango de
--   fecha; "Repetir pedido" ordena por fecha.
-- - OrderLine(productId): los controles y el catálogo buscan los renglones de
--   un producto; la clave única empieza por eventId y no sirve para eso.
-- - StockMovement(productId, createdAt) y (createdAt): el historial de un
--   producto y la lista general, de lo más nuevo a lo más viejo. No tenía
--   ningún índice.
-- - Notification(eventId): vaciar la papelera borra los avisos de un evento.

CREATE INDEX "Event_date_idx" ON "Event"("date");
CREATE INDEX "OrderLine_productId_idx" ON "OrderLine"("productId");
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");
CREATE INDEX "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");
CREATE INDEX "Notification_eventId_idx" ON "Notification"("eventId");
