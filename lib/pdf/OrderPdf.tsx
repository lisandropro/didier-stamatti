import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { buildBlocks, layoutColumns, pickColumns, totalUnits, type PickBlock } from "@/lib/picklist";

export type PdfLine = { name: string; unit: string | null; qty: number; note: string | null; rubro?: string | null };
export type PdfSection = { key: string; label: string; products: PdfLine[]; customs: PdfLine[] };
export type OrderPdfData = {
  lugar: string;
  dateLabel: string;
  guests: number;
  responsable: string | null;
  sections: PdfSection[];
};

const INK = "#141312";
const MUTED = "#6b6862";
const HAIR = "#d9d6cf";
const SOFT = "#f3f2ef";
const GOLD = "#9a7636";

/** Cuerpo de letra según cuántas columnas entren. Achicar es el último recurso:
 *  primero se gana lugar con las columnas. */
const FONT: Record<number, { size: number; gap: number }> = {
  1: { size: 10, gap: 18 },
  2: { size: 9, gap: 14 },
  3: { size: 8, gap: 10 },
};

const s = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 42, paddingHorizontal: 32, color: INK, fontFamily: "Helvetica" },
  brandRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  brand: { fontSize: 15, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  sectionLabel: { fontSize: 15, fontFamily: "Helvetica-Bold", color: GOLD, letterSpacing: 0.5 },
  headerRule: { borderBottomWidth: 1.5, borderBottomColor: INK, marginTop: 6, marginBottom: 10 },

  // Los datos del evento van en una sola línea: cada renglón que ocupa la
  // cabecera es un renglón menos de pedido en la hoja.
  infoBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderColor: HAIR,
    borderRadius: 4,
    backgroundColor: SOFT,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginBottom: 10,
  },
  infoCell: { flexDirection: "row", marginRight: 18 },
  infoK: { color: MUTED, fontFamily: "Helvetica-Bold", fontSize: 8, marginRight: 4 },
  infoV: { fontSize: 9 },

  columns: { flexDirection: "row", alignItems: "flex-start" },
  column: { flex: 1 },

  group: {
    fontFamily: "Helvetica-Bold",
    color: GOLD,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 5,
    marginBottom: 2,
  },
  row: { flexDirection: "row", alignItems: "flex-start", borderBottomWidth: 0.5, borderColor: HAIR, paddingVertical: 2.4 },
  check: { width: 8, height: 8, borderWidth: 0.8, borderColor: INK, borderRadius: 1.5, marginTop: 1.5, marginRight: 5 },
  name: { flex: 1, paddingRight: 4 },
  unit: { color: MUTED },
  note: { color: MUTED, marginTop: 0.5 },
  qty: { fontFamily: "Helvetica-Bold", textAlign: "right", minWidth: 24 },

  footer: {
    position: "absolute",
    bottom: 20,
    left: 32,
    right: 32,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.6,
    borderColor: HAIR,
    paddingTop: 5,
  },
  footText: { fontSize: 7.5, color: MUTED },
  empty: { color: MUTED, marginTop: 20, fontSize: 10 },
});

function Blocks({ blocks, size }: { blocks: PickBlock[]; size: number }) {
  return (
    <View>
      {blocks.map((b, i) =>
        b.kind === "group" ? (
          <Text key={i} style={[s.group, { fontSize: size - 1.5 }]}>
            {b.label}
          </Text>
        ) : (
          <View key={i} style={s.row} wrap={false}>
            <View style={s.check} />
            <View style={s.name}>
              <Text style={{ fontSize: size }}>
                {b.item.name}
                {b.item.unit && b.item.unit !== "Unidad" ? (
                  <Text style={s.unit}> · {b.item.unit}</Text>
                ) : null}
              </Text>
              {b.item.note ? <Text style={[s.note, { fontSize: size - 1.5 }]}>{b.item.note}</Text> : null}
            </View>
            <Text style={[s.qty, { fontSize: size }]}>{b.item.qty}</Text>
          </View>
        )
      )}
    </View>
  );
}

/** Una hoja de un sector: cabecera, datos del evento y la lista en columnas. */
function SectionPage({
  data,
  label,
  columns,
  size,
  gap,
  pageOf,
}: {
  data: OrderPdfData;
  label: string;
  columns: PickBlock[][];
  size: number;
  gap: number;
  pageOf: string | null;
}) {
  return (
    <Page size="A4" style={s.page}>
      <View style={s.brandRow}>
        <Text style={s.brand}>DIDIER STAMATTI</Text>
        <Text style={s.sectionLabel}>{label}</Text>
      </View>
      <View style={s.headerRule} />

      <View style={s.infoBar}>
        <View style={s.infoCell}><Text style={s.infoK}>LUGAR</Text><Text style={s.infoV}>{data.lugar}</Text></View>
        <View style={s.infoCell}><Text style={s.infoK}>FECHA</Text><Text style={s.infoV}>{data.dateLabel}</Text></View>
        <View style={s.infoCell}><Text style={s.infoK}>INVITADOS</Text><Text style={s.infoV}>{data.guests}</Text></View>
        <View style={s.infoCell}><Text style={s.infoK}>RESPONSABLE</Text><Text style={s.infoV}>{data.responsable || "—"}</Text></View>
        {pageOf ? <View style={s.infoCell}><Text style={s.infoK}>HOJA</Text><Text style={s.infoV}>{pageOf}</Text></View> : null}
      </View>

      <View style={[s.columns, { gap }]}>
        {columns.map((col, i) => (
          <View key={i} style={s.column}>
            <Blocks blocks={col} size={size} />
          </View>
        ))}
      </View>

      <View style={s.footer} fixed>
        <Text style={s.footText}>Preparado por: ____________________     Revisado por: ____________________</Text>
        <Text style={s.footText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </Page>
  );
}

export function OrderPdf({ data }: { data: OrderPdfData }) {
  const activeSections = data.sections.filter((sec) => sec.products.length > 0 || sec.customs.length > 0);

  return (
    <Document title={`Pedido - ${data.lugar}`} author="Didier Stamatti Catering">
      {activeSections.length === 0 ? (
        <Page size="A4" style={s.page}>
          <Text style={s.brand}>DIDIER STAMATTI</Text>
          <View style={s.headerRule} />
          <Text style={s.empty}>Este pedido todavía no tiene productos cargados.</Text>
        </Page>
      ) : (
        // Un sector por hoja: cada uno va a un depósito distinto.
        activeSections.flatMap((sec) => {
          const blocks = buildBlocks(sec.products, sec.customs);
          const cols = pickColumns(totalUnits(blocks));
          const { size, gap } = FONT[cols];
          const pages = layoutColumns(blocks, cols);

          return pages.map((columns, i) => (
            <SectionPage
              key={`${sec.key}-${i}`}
              data={data}
              label={sec.label}
              columns={columns}
              size={size}
              gap={gap}
              pageOf={pages.length > 1 ? `${i + 1} de ${pages.length}` : null}
            />
          ));
        })
      )}
    </Document>
  );
}

/** Genera el PDF del pedido como Buffer (se usa en la ruta /api del servidor). */
export function renderOrderPdf(data: OrderPdfData): Promise<Buffer> {
  return renderToBuffer(<OrderPdf data={data} />);
}
