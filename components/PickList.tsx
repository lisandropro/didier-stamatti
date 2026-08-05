import { buildBlocks, pickColumns, totalUnits, type PickItem } from "@/lib/picklist";

/** Lista de un sector para imprimir. Va en columnas para que un pedido grande
 *  entre en una sola hoja; el corte de columna lo hace el navegador. */
export function PickList({ products, customs }: { products: PickItem[]; customs: PickItem[] }) {
  const blocks = buildBlocks(products, customs);
  const cols = pickColumns(totalUnits(blocks));

  return (
    <div className={`picklist cols-${cols}`}>
      {blocks.map((b, i) =>
        b.kind === "group" ? (
          <div key={i} className="pl-group">{b.label}</div>
        ) : (
          <div key={b.item.id ?? i} className="pl-row">
            <span className="pl-check" />
            <span className="pl-name">
              {b.item.name}
              {b.item.unit && b.item.unit !== "Unidad" ? <span className="pl-unit"> · {b.item.unit}</span> : null}
              {b.item.note ? <span className="pl-note">{b.item.note}</span> : null}
            </span>
            <span className="pl-qty">{b.item.qty}</span>
          </div>
        )
      )}
    </div>
  );
}
