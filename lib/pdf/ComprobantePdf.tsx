import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { DatosDocumento } from "@/lib/comprobantes/documento";

// El PDF del documento reconstruido.
//
// Las decisiones de QUÉ se muestra viven en `lib/comprobantes/documento.ts`.
// Acá solo se dibuja: todo lo que llega es texto ya formateado.
//
// **La regla que ordena el diseño**: en ningún momento se tiene que poder
// confundir con el comprobante original. Por eso la primera línea de la hoja no
// es el nombre del proveedor sino la palabra DETALLE, y el pie de procedencia va
// dentro de un recuadro, no en gris chiquito al borde.

const INK = "#141312";
const MUTED = "#5a5a5a";
const HAIR = "#b8b8b8";
const SOFT = "#f2f2f0";
const ALERTA = "#8A1F27";
const ALERTA_FONDO = "#FBF0F0";

const s = StyleSheet.create({
  page: {
    paddingTop: 34,
    paddingBottom: 40,
    paddingHorizontal: 36,
    color: INK,
    fontFamily: "Helvetica",
    fontSize: 9.5,
  },

  // --- Cabecera ---
  // "DETALLE DE FACTURA" arriba de todo y en grande. Es lo primero que se lee, y
  // dice qué es esta hoja antes de que nadie mire un número.
  titulo: { fontSize: 15, fontFamily: "Helvetica-Bold", letterSpacing: 1.2 },
  subtitulo: { fontSize: 8.5, color: MUTED, marginTop: 2 },
  reglaTitulo: { borderBottomWidth: 1.5, borderBottomColor: INK, marginTop: 8, marginBottom: 14 },

  // La franja de alerta va ARRIBA, debajo del título.
  //
  // En la primera versión el aviso estaba solo en el pie, quince centímetros
  // debajo del total que cuestiona. Al mirar el PDF con la factura real quedó
  // claro: quien lee el total y cierra la hoja no lo ve nunca — y en un
  // comprobante de dos páginas, ni siquiera está en la misma hoja.
  franja: {
    borderWidth: 1,
    borderColor: ALERTA,
    backgroundColor: ALERTA_FONDO,
    padding: 8,
    marginBottom: 12,
  },
  franjaTexto: { fontSize: 9.5, fontFamily: "Helvetica-Bold", color: ALERTA },

  recepcion: { fontSize: 8.5, color: MUTED, marginTop: 8 },

  filaCabecera: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  proveedor: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  cuit: { fontSize: 10, color: MUTED, marginTop: 2 },
  comprobante: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginTop: 6 },
  emision: { fontSize: 9.5, color: MUTED, marginTop: 2 },

  // El vencimiento es el dato por el que se abre esta hoja: va en un recuadro, a
  // la derecha, donde cae la vista.
  cajaVto: {
    borderWidth: 1.2,
    borderColor: INK,
    paddingVertical: 7,
    paddingHorizontal: 12,
    alignItems: "center",
    minWidth: 128,
  },
  cajaVtoLabel: { fontSize: 7.5, letterSpacing: 1.4, color: MUTED },
  cajaVtoValor: { fontSize: 15, fontFamily: "Helvetica-Bold", marginTop: 3 },

  // --- Tabla ---
  tablaCabeza: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: INK,
    paddingBottom: 4,
    marginTop: 18,
  },
  fila: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: HAIR,
    paddingVertical: 4,
  },
  th: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  cCodigo: { width: 52 },
  cDesc: { flex: 1, paddingRight: 8 },
  cCant: { width: 78, textAlign: "right" },
  cPrecio: { width: 88, textAlign: "right" },
  cSub: { width: 88, textAlign: "right" },
  // Monoespaciada en todo lo numérico: es lo que deja las comas en columna, y
  // una columna de importes que no alinea se recorre con el dedo.
  num: { fontFamily: "Courier" },

  vacia: { fontSize: 9, color: MUTED, fontStyle: "italic", marginTop: 10 },

  // --- Totales ---
  totales: { marginTop: 14, alignItems: "flex-end" },
  filaTotal: { flexDirection: "row", justifyContent: "flex-end", marginTop: 2 },
  etiquetaTotal: { width: 110, textAlign: "right", paddingRight: 10, color: MUTED },
  valorTotal: { width: 110, textAlign: "right", fontFamily: "Courier" },
  granTotal: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  granTotalNum: { fontSize: 13, fontFamily: "Courier-Bold", width: 110, textAlign: "right" },
  leyendaTotal: { fontSize: 8.5, color: ALERTA, marginTop: 4, fontFamily: "Helvetica-Bold" },
  cae: { fontSize: 8, color: MUTED, marginTop: 12 },

  // --- Pie de procedencia ---
  // Va en un recuadro y NO en gris al borde de la hoja. Un aviso que hay que
  // buscar es un aviso que no existe.
  pie: {
    marginTop: 22,
    borderWidth: 1,
    borderColor: HAIR,
    backgroundColor: SOFT,
    padding: 10,
  },
  pieAlerta: { borderColor: ALERTA, backgroundColor: ALERTA_FONDO },
  pieTitulo: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  pieTexto: { fontSize: 8.5, color: MUTED, marginTop: 3, lineHeight: 1.4 },
  pieAdvertencia: { fontSize: 9, fontFamily: "Helvetica-Bold", color: ALERTA, marginTop: 5 },

  numeroPagina: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    fontSize: 7.5,
    color: MUTED,
    textAlign: "center",
  },
});

export function ComprobantePdf({ datos }: { datos: DatosDocumento }) {
  const { encabezado, renglones, totales, procedencia } = datos;
  const hayAdvertencia = procedencia.advertencia !== undefined;

  return (
    <Document title={`${datos.titulo} · ${encabezado.proveedor}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.titulo}>{datos.titulo}</Text>
        <Text style={s.subtitulo}>Reconstruido por el sistema · No es el comprobante original</Text>
        <View style={s.reglaTitulo} />

        {/* Todo lo que hay que saber ANTES de mirar el total. */}
        {(procedencia.advertencia !== undefined || datos.recepcion?.alerta !== undefined) && (
          <View style={s.franja}>
            {datos.recepcion?.alerta !== undefined && (
              <Text style={s.franjaTexto}>{datos.recepcion.alerta}</Text>
            )}
            {procedencia.advertencia !== undefined && (
              <Text style={[s.franjaTexto, ...(datos.recepcion?.alerta ? [{ marginTop: 4 }] : [])]}>
                {procedencia.advertencia}
              </Text>
            )}
          </View>
        )}

        <View style={s.filaCabecera}>
          <View style={{ flex: 1, paddingRight: 16 }}>
            <Text style={s.proveedor}>{encabezado.proveedor}</Text>
            {encabezado.cuit !== "" && <Text style={s.cuit}>CUIT {encabezado.cuit}</Text>}
            <Text style={s.comprobante}>{encabezado.comprobante}</Text>
            {encabezado.fecha !== "" && (
              <Text style={s.emision}>Emitida el {encabezado.fecha}</Text>
            )}
          </View>

          {/* Sin vencimiento no se dibuja la caja vacía: un recuadro con una
              raya adentro se lee como un dato, y acá no hay dato. */}
          {encabezado.vencimiento !== "" && (
            <View style={s.cajaVto}>
              <Text style={s.cajaVtoLabel}>VENCE</Text>
              <Text style={s.cajaVtoValor}>{encabezado.vencimiento}</Text>
            </View>
          )}
        </View>

        {renglones.length > 0 ? (
          <>
            <View style={s.tablaCabeza} fixed>
              <Text style={[s.th, s.cCodigo]}>CÓDIGO</Text>
              <Text style={[s.th, s.cDesc]}>DESCRIPCIÓN</Text>
              <Text style={[s.th, s.cCant]}>CANTIDAD</Text>
              <Text style={[s.th, s.cPrecio]}>P. UNITARIO</Text>
              <Text style={[s.th, s.cSub]}>SUBTOTAL</Text>
            </View>
            {renglones.map((r, i) => (
              <View key={i} style={s.fila} wrap={false}>
                <Text style={[s.cCodigo, s.num]}>{r.codigo}</Text>
                <Text style={s.cDesc}>{r.descripcion}</Text>
                <Text style={[s.cCant, s.num]}>{r.cantidad}</Text>
                <Text style={[s.cPrecio, s.num]}>{r.precioUnitario}</Text>
                <Text style={[s.cSub, s.num]}>{r.subtotal}</Text>
              </View>
            ))}
          </>
        ) : (
          <Text style={s.vacia}>Este comprobante no tiene detalle cargado.</Text>
        )}

        <View style={s.totales}>
          {totales.neto !== "" && (
            <View style={s.filaTotal}>
              <Text style={s.etiquetaTotal}>Neto</Text>
              <Text style={s.valorTotal}>{totales.neto}</Text>
            </View>
          )}
          {totales.iva !== "" && (
            <View style={s.filaTotal}>
              <Text style={s.etiquetaTotal}>IVA</Text>
              <Text style={s.valorTotal}>{totales.iva}</Text>
            </View>
          )}
          {totales.percepciones !== "" && totales.percepciones !== "$ 0,00" && (
            <View style={s.filaTotal}>
              <Text style={s.etiquetaTotal}>Percepciones</Text>
              <Text style={s.valorTotal}>{totales.percepciones}</Text>
            </View>
          )}
          {totales.total !== "" && (
            <View style={[s.filaTotal, { marginTop: 6 }]}>
              <Text style={[s.etiquetaTotal, s.granTotal, { color: INK }]}>TOTAL</Text>
              <Text style={s.granTotalNum}>{totales.total}</Text>
            </View>
          )}
          {totales.leyendaTotal !== undefined && (
            <Text style={s.leyendaTotal}>{totales.leyendaTotal}</Text>
          )}
        </View>

        {/* El CAE va como dato de búsqueda, en chico y sin adornos. Sin código
            de barras y sin la leyenda de autorización: eso es lo que hace que un
            papel parezca válido ante un tercero, y este no lo es. */}
        {totales.cae !== "" && <Text style={s.cae}>CAE {totales.cae}</Text>}

        {/* Cómo se recibió la mercadería. Lo cargaba el depósito y no lo veía
            nadie más; para quien paga es el dato que dice si el total impreso
            es lo que hay que transferir. */}
        {datos.recepcion !== null && datos.recepcion.linea !== "" && (
          <Text style={s.recepcion}>Recepción: {datos.recepcion.linea}</Text>
        )}

        <View style={[s.pie, ...(hayAdvertencia ? [s.pieAlerta] : [])]}>
          <Text style={s.pieTitulo}>Cómo se armó esta hoja</Text>
          <Text style={s.pieTexto}>
            {procedencia.leyenda} Dato {procedencia.origen}, generado el {procedencia.fecha}.
            {procedencia.verificado ? " Las cuentas del comprobante cierran." : ""}
            {procedencia.nota !== undefined ? ` ${procedencia.nota}` : ""}
          </Text>
          {/* La advertencia NO se repite acá: vive en la franja de arriba, que
              es donde se lee. Repetirla enseñaría a saltearla en los dos lados. */}
        </View>

        <Text
          style={s.numeroPagina}
          render={({ pageNumber, totalPages }) =>
            `${encabezado.proveedor} · ${encabezado.comprobante} · página ${pageNumber} de ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}

/** Genera el PDF como Buffer, para la ruta de servidor. */
export function renderComprobantePdf(datos: DatosDocumento): Promise<Buffer> {
  return renderToBuffer(<ComprobantePdf datos={datos} />);
}
