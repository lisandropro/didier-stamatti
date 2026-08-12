"use client";

import { useEffect, useState } from "react";
import { getEventShortages } from "@/app/actions/shortages";
import type { ShortageRow } from "@/lib/shortage-rule";

const IconWarn = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
);

/** Panel informativo de faltantes de un evento. Solo lee: no toca pedidos,
 *  productos ni movimientos. */
export function ShortagesModal({
  eventId,
  lugar,
  onClose,
}: {
  eventId: string;
  lugar: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ShortageRow[] | null>(null);
  const [periodLabel, setPeriodLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    let vivo = true;
    getEventShortages(eventId).then((res) => {
      if (!vivo) return;
      if (!res.ok) return setError(res.error ?? "No se pudieron calcular los faltantes.");
      setRows(res.rows ?? []);
      setPeriodLabel(res.periodLabel ?? null);
    });
    return () => {
      vivo = false;
    };
  }, [eventId]);

  const compartidos = rows?.filter((r) => r.causedByOthers).length ?? 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-xwide modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Faltantes de {lugar}</h2>
          <p className="modal-sub">
            El depósito es uno solo para todo el período{periodLabel ? ` (${periodLabel})` : ""}: lo que piden los
            otros eventos también descuenta. Es solo informativo — no cambia ningún pedido.
          </p>
        </div>

        <div className="sheet-body">
          {error && <div className="form-error">{error}</div>}
          {rows === null && !error && <p className="trash-meta">Calculando…</p>}

          {rows?.length === 0 && (
            <div className="empty-card">
              <p className="empty-title">No falta nada para este evento</p>
              <p>Todo lo que pide entra en el stock disponible del período.</p>
            </div>
          )}

          {rows && rows.length > 0 && (
            <>
              {compartidos > 0 && (
                <div className="banner crit">
                  {IconWarn}
                  <div>
                    <b>
                      {compartidos === 1
                        ? "1 producto ya estaba agotado antes de este evento"
                        : `${compartidos} productos ya estaban agotados antes de este evento`}
                    </b>
                    <p>
                      Los otros eventos del período solos se pasan del stock, así que el faltante es del conjunto y no
                      de este pedido. Están marcados abajo.
                    </p>
                  </div>
                </div>
              )}

              {/* Pantalla ancha */}
              <div className="tablewrap falta-tabla">
                <table>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Pide este evento</th>
                      <th>Piden los otros</th>
                      <th>Total del finde</th>
                      <th>En el depósito</th>
                      <th>Disponible acá</th>
                      <th>Falta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.productId}>
                        <td>
                          <div className="prod">{r.name}</div>
                          <div className="rubro">
                            {r.unit}
                            {r.rubro ? ` · ${r.rubro}` : ""}
                            {r.causedByOthers ? " · ya agotado por los otros eventos" : ""}
                          </div>
                        </td>
                        <td><span className="stocknum">{r.requested}</span></td>
                        <td className="dim">{r.otherRequested}</td>
                        <td><span className="stocknum">{r.totalRequested}</span></td>
                        <td className="dim">{r.stock}</td>
                        <td>
                          <span className="stocknum" style={{ color: r.available === 0 ? "var(--crit)" : undefined }}>
                            {r.available}
                          </span>
                        </td>
                        <td><span className="chip crit">{r.missing}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Teléfono */}
              <div className="falta-cards">
                {rows.map((r) => (
                  <div className="falta-card" key={r.productId}>
                    <div className="falta-card-top">
                      <div>
                        <div className="prod">{r.name}</div>
                        <div className="rubro">
                          {r.unit}
                          {r.rubro ? ` · ${r.rubro}` : ""}
                          {r.causedByOthers ? " · ya agotado por los otros" : ""}
                        </div>
                      </div>
                      <span className="chip crit">Faltan {r.missing}</span>
                    </div>
                    <dl className="falta-nums">
                      <dt>Pide este evento</dt><dd>{r.requested}</dd>
                      <dt>Piden los otros eventos</dt><dd>{r.otherRequested}</dd>
                      <dt>Total del período</dt><dd>{r.totalRequested}</dd>
                      <dt>Hay en el depósito</dt><dd>{r.stock}</dd>
                      <dt>Le queda a este evento</dt>
                      <dd className={r.available === 0 ? "destacado" : undefined}>{r.available}</dd>
                    </dl>
                  </div>
                ))}
              </div>

              <p className="modal-sub" style={{ marginTop: "var(--sp-4)" }}>
                <b>Disponible acá</b> es lo que queda del depósito después de lo que piden los otros eventos.{" "}
                <b>Falta</b> es cuánto habría que conseguir para que entren todos.
              </p>
            </>
          )}
        </div>

        <div className="sheet-foot">
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
