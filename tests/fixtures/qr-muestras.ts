// Payloads de QR sacados de comprobantes REALES el 01/09/2026.
//
// Los valores estan cambiados —CUIT, importes y CAE son inventados— pero
// **las patologias son exactas**: los ceros a la izquierda, las comillas que
// faltan, los guiones en el CUIT, la fecha al reves y el nroCmp ausente son
// tal cual vinieron. Lo que se prueba es la FORMA, no los numeros, asi que
// anonimizar no le saca nada al caso de prueba y evita que los datos de los
// proveedores viajen al repositorio remoto.
//
// De 5 QR de factura leidos, 2 NO pasan por JSON.parse. Por eso el lector no
// puede usarlo.

export type MuestraQr = { nombre: string; nota: string; url: string };

export const QR_MUESTRAS: MuestraQr[] = [
  {
    nombre: "sano",
    nota: "Bien formado: el caso que todos los lectores asumen.",
    url: "https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0wOC0yNyIsImN1aXQiOjIwOTk5OTk5OTkzLCJwdG9WdGEiOjYsInRpcG9DbXAiOjEsIm5yb0NtcCI6NTc4NzUsImltcG9ydGUiOjc2NDEwNy4xMSwibW9uZWRhIjoiUEVTIiwiY3R6IjoxLCJ0aXBvRG9jUmVjIjo4MCwibnJvRG9jUmVjIjozMDcxNzczNzQ4OSwidGlwb0NvZEF1dCI6IkUiLCJjb2RBdXQiOjg2MzUwMTA2OTkwNDY4fQ==",
  },
  {
    nombre: "sanoConSaltoDeLinea",
    nota: "Bien formado pero con CRLF al final del JSON.",
    url: "https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0wOC0wNCIsImN1aXQiOjMwOTk5OTk5OTk0LCJwdG9WdGEiOjIwMywidGlwb0NtcCI6MSwibnJvQ21wIjozODYwNCwiaW1wb3J0ZSI6MzEwMDAwLjAxLCJtb25lZGEiOiJQRVMiLCJjdHoiOjEsInRpcG9Eb2NSZWMiOjgwLCJucm9Eb2NSZWMiOjMwNzE3NzM3NDg5LCJ0aXBvQ29kQXV0IjoiRSIsImNvZEF1dCI6ODYzMTY3NjEzMDU2ODl9DQo=",
  },
  {
    nombre: "cerosALaIzquierda",
    nota: "JSON INVALIDO: 01 y 00046293 no son numeros JSON validos.",
    url: "https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0wOC0yNiIsImN1aXQiOjMwOTk5OTk5OTk1LCJwdG9WdGEiOjQ1NTIsInRpcG9DbXAiOjAxLCJucm9DbXAiOjAwMDQ2MjkzLCJpbXBvcnRlIjo1MDUwMjAyLjE3LCJtb25lZGEiOiJQRVMiLCJjdHoiOjEsInRpcG9Eb2NSZWMiOjgwLCJucm9Eb2NSZWMiOjMwNzE3NzM3NDg5LCJ0aXBvQ29kQXV0IjoiQSIsImNvZEF1dCI6ODYzNDAwMjgzMjU1MjV9",
  },
  {
    nombre: "sinComillasNiNumero",
    nota: "JSON INVALIDO y sin nroCmp. Fecha DD-MM-YYYY, CUIT con guiones, textos sin comillas.",
    url: "https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoxMS0wOC0yMDI2LCJjdWl0Ijo5MDYtMjkwMTUwLTMsInB0b1Z0YSI6MDE5NywidGlwb0NtcCI6MDAxLCJpbXBvcnRlIjozODcxMjQuNTEwMDAwMDAwMDAwMDAwMCwibW9uZWRhIjpBUlMsImN0eiI6MS4wMDAwMDAwMDAwMDAwMDAwLCJ0aXBvRG9jUmVjIjpDVUlULCJucm9Eb2NSZWMiOjMwLTcxNzczNzQ4LTksInRpcG9Db2RBdXQiOkUsImNvZEF1dCI6ODYzMjc4NTAzOTc3NjN9",
  },
];

// QR que aparecen en la MISMA foto y no identifican un comprobante. Una foto
// puede traer varios: hay que quedarse con el de factura, no con el primero.
export const QR_QUE_NO_SON_FACTURA = [
  "https://qrco.de/bgCzSS", // marketing impreso por el proveedor
  "http://qr.afip.gob.ar/?qr=s9yzwfkqOromt09uViT0Eg,,", // Data Fiscal: es de AFIP pero no es una factura
];
