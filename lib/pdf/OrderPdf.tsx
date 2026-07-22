import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

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

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 46, paddingHorizontal: 40, fontSize: 10, color: INK, fontFamily: "Helvetica" },
  brand: { fontSize: 16, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  brandSub: { fontSize: 9, color: MUTED, marginTop: 2 },
  headerRule: { borderBottomWidth: 1.5, borderBottomColor: INK, marginTop: 8, marginBottom: 14 },

  infoBox: { borderWidth: 1, borderColor: HAIR, borderRadius: 6, padding: 10, marginBottom: 18, flexDirection: "row", flexWrap: "wrap" },
  infoCell: { width: "50%", flexDirection: "row", paddingVertical: 3 },
  infoK: { width: 74, color: MUTED, fontFamily: "Helvetica-Bold", fontSize: 9 },
  infoV: { flex: 1, fontSize: 10 },

  sectionTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 6, marginBottom: 6, color: INK },
  subTitle: { fontSize: 9, color: GOLD, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },

  thead: { flexDirection: "row", backgroundColor: SOFT, borderTopWidth: 1, borderBottomWidth: 1, borderColor: HAIR, paddingVertical: 5, paddingHorizontal: 6 },
  th: { fontSize: 8, color: MUTED, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.4 },
  row: { flexDirection: "row", borderBottomWidth: 0.6, borderColor: HAIR, paddingVertical: 5, paddingHorizontal: 6 },
  cName: { flex: 3 },
  cUnit: { flex: 1.4, color: MUTED },
  cQty: { flex: 1, textAlign: "right", fontFamily: "Helvetica-Bold" },
  cNote: { flex: 2.4, color: MUTED, paddingLeft: 8 },
  prodName: { fontSize: 10 },
  prodRubro: { fontSize: 8, color: MUTED, marginTop: 1 },

  footer: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.6, borderColor: HAIR, paddingTop: 6 },
  footText: { fontSize: 8, color: MUTED },
});

function Table({ lines }: { lines: PdfLine[] }) {
  return (
    <View>
      <View style={s.thead}>
        <Text style={[s.th, s.cName]}>Producto</Text>
        <Text style={[s.th, s.cUnit]}>Unidad</Text>
        <Text style={[s.th, s.cQty]}>Cant.</Text>
        <Text style={[s.th, s.cNote]}>Nota</Text>
      </View>
      {lines.map((l, i) => (
        <View style={s.row} key={i} wrap={false}>
          <View style={s.cName}>
            <Text style={s.prodName}>{l.name}</Text>
            {l.rubro ? <Text style={s.prodRubro}>{l.rubro}</Text> : null}
          </View>
          <Text style={s.cUnit}>{l.unit && l.unit !== "Unidad" ? l.unit : ""}</Text>
          <Text style={s.cQty}>{l.qty}</Text>
          <Text style={s.cNote}>{l.note ?? ""}</Text>
        </View>
      ))}
    </View>
  );
}

export function OrderPdf({ data }: { data: OrderPdfData }) {
  const activeSections = data.sections.filter((sec) => sec.products.length > 0 || sec.customs.length > 0);

  return (
    <Document title={`Pedido - ${data.lugar}`} author="Didier Stamatti Catering">
      <Page size="A4" style={s.page}>
        <View>
          <Text style={s.brand}>DIDIER STAMATTI</Text>
          <Text style={s.brandSub}>Pedido del evento</Text>
        </View>
        <View style={s.headerRule} />

        <View style={s.infoBox}>
          <View style={s.infoCell}><Text style={s.infoK}>Lugar</Text><Text style={s.infoV}>{data.lugar}</Text></View>
          <View style={s.infoCell}><Text style={s.infoK}>Fecha</Text><Text style={s.infoV}>{data.dateLabel}</Text></View>
          <View style={s.infoCell}><Text style={s.infoK}>Invitados</Text><Text style={s.infoV}>{data.guests}</Text></View>
          <View style={s.infoCell}><Text style={s.infoK}>Responsable</Text><Text style={s.infoV}>{data.responsable || "—"}</Text></View>
        </View>

        {activeSections.length === 0 ? (
          <Text style={{ color: MUTED, marginTop: 20 }}>Este pedido todavía no tiene productos cargados.</Text>
        ) : (
          activeSections.map((sec) => (
            <View key={sec.key} style={{ marginBottom: 14 }} wrap={false}>
              <Text style={s.sectionTitle}>{sec.label}</Text>
              {sec.products.length > 0 && <Table lines={sec.products} />}
              {sec.customs.length > 0 && (
                <>
                  <Text style={s.subTitle}>Extras (fuera de catálogo)</Text>
                  <Table lines={sec.customs} />
                </>
              )}
            </View>
          ))
        )}

        <View style={s.footer} fixed>
          <Text style={s.footText}>Didier Stamatti Catering — {data.lugar}</Text>
          <Text style={s.footText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Genera el PDF del pedido como Buffer (se usa en la ruta /api del servidor). */
export function renderOrderPdf(data: OrderPdfData): Promise<Buffer> {
  return renderToBuffer(<OrderPdf data={data} />);
}
