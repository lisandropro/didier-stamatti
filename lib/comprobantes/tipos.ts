/** Lo que un lector logró sacar de un comprobante. Todo opcional salvo la
 *  fuente, porque cada peldaño de la cascada saca menos que el anterior — y
 *  porque hay QR reales que vienen sin número. */
export type Cabecera = {
  fuente: Fuente;
  cuitEmisor?: string;
  /** A nombre de quién está la factura. Sirve para avisar si alguien
   *  fotografía la de otra empresa. */
  cuitReceptor?: string;
  tipoCbte?: string;
  puntoVenta?: number;
  numero?: number;
  fechaEmision?: string; // "AAAA-MM-DD"
  importeTotal?: bigint; // centavos
  cae?: string;
  caeVence?: string; // NO es el vencimiento del pago
};

/** Un valor por peldaño de la cascada de identificación. */
export type Fuente = "ARCA" | "QR" | "EMPAREJADO" | "LECTURA" | "MANUAL";

export type Kind = "FACTURA" | "REMITO" | "TICKET" | "NOTA_CREDITO" | "NOTA_DEBITO" | "OTRO";

export type Destino = "COCINA" | "DEPOSITO" | "OTRO";
