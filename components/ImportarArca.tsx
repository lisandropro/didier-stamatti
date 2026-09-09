"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { previsualizarArca, importarArca } from "@/app/actions/comprobantes";
import type { ResultadoImportacion } from "@/lib/comprobantes/arca";
import type { Salteada } from "@/lib/comprobantes/arca-csv";
import type { ConvertidaVisible } from "@/lib/comprobantes/politica";

// Importar el CSV de *Mis Comprobantes → Recibidos*.
//
// **Dos pasos, y el primero no escribe.** Se mira qué va a pasar y recién
// después se aplica. Para una operación que CREA comprobantes y mueve deuda,
// poder mirar antes vale — sobre todo la primera vez, que es cuando no se sabe
// qué esperar y es la que puede traer cientos de facturas.
//
// El archivo se vuelve a mandar al confirmar en vez de guardarlo en el
// servidor: el navegador ya lo tiene, y así no hay estado a medio camino que
// pueda quedar colgado.

export function ImportarArca({
  entidades,
}: {
  entidades: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [previa, setPrevia] = useState<ResultadoImportacion | null>(null);
  const [entidadPrevia, setEntidadPrevia] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<ResultadoImportacion | null>(null);
  const [ocupado, setOcupado] = useState(false);
  /** El nombre del archivo elegido. El control nativo lo mostraba; al
   *  esconderlo hay que reponerlo o se pierde la confirmacion de que se
   *  eligio algo. */
  const [elegido, setElegido] = useState<string | null>(null);
  /** Las filas que se entienden pero no entran —hoy, las que están en otra
   *  moneda—. **No se limpian al importar**: después de aplicar, la previa
   *  desaparece y esto es lo único que queda diciendo que hay comprobantes que
   *  cargar a mano. Si se borraran junto con la previa, el archivo real habría
   *  entrado con tres facturas menos y nadie se enteraba. */
  const [salteadas, setSalteadas] = useState<Salteada[]>([]);
  /** Las que venían en otra moneda y se pasaron a pesos. Se muestran por la
   *  misma razón que las salteadas, y una más: **es el único importe del
   *  sistema que no está impreso en ningún papel.** */
  const [convertidas, setConvertidas] = useState<ConvertidaVisible[]>([]);
  /** Cuántas quedaron fuera por el corte de fecha. Sin este número, un corte
   *  mal puesto se ve igual que un archivo corto. */
  const [omitidas, setOmitidas] = useState(0);

  async function mirar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    setHecho(null);
    setPrevia(null);
    setSalteadas([]);
    setConvertidas([]);
    setOmitidas(0);
    const r = await previsualizarArca(new FormData(e.currentTarget));
    setOcupado(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPrevia(r.previa);
    setEntidadPrevia(r.entidad);
    setSalteadas(r.salteadas);
    setConvertidas(r.convertidas);
    setOmitidas(r.omitidasPorFecha);
  }

  async function aplicar() {
    const form = formRef.current;
    if (!form || ocupado) return;
    setOcupado(true);
    setError(null);
    // El mismo archivo otra vez. Entre mirar y aplicar alguien pudo cargar una
    // factura, así que lo que vale es lo que devuelve la aplicación — no la
    // previa.
    const r = await importarArca(new FormData(form));
    setOcupado(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPrevia(null);
    setHecho(r.resultado);
    setSalteadas(r.salteadas);
    setConvertidas(r.convertidas);
    setOmitidas(r.omitidasPorFecha);
    form.reset();
    setElegido(null);
    router.refresh();
  }

  return (
    <div className="imp">
      <form ref={formRef} onSubmit={mirar} className="imp-form">
        {entidades.length > 1 && (
          <div className="field">
            <label htmlFor="imp-entidad">¿De qué entidad es este archivo?</label>
            <select id="imp-entidad" name="entidadId">
              {entidades.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* El control de archivo del navegador no se puede estilar y no se
            parece a ningún otro campo de la app. La forma estándar y accesible
            es esconderlo —sin sacarlo del foco por teclado— y usar su `<label>`
            como el botón. El nombre del archivo elegido se muestra al lado,
            porque el control nativo lo hacía y perderlo sería un retroceso. */}
        <div className="imp-archivo">
          <input
            id="imp-archivo"
            name="archivo"
            type="file"
            accept=".csv,text/csv"
            required
            className="sr-only"
            onChange={(ev) => setElegido(ev.target.files?.[0]?.name ?? null)}
          />
          <label htmlFor="imp-archivo" className="btn ghost">
            {elegido ? "Cambiar archivo" : "Elegir archivo"}
          </label>
          <span className={elegido ? "imp-nombre" : "imp-nombre imp-vacio"}>
            {elegido ?? "Ningún archivo elegido"}
          </span>
        </div>

        {/* **El corte de fecha, y por qué está acá.** ARCA no dice si una
            factura ya se pagó. Traer nueve meses hace que la pantalla de pagos
            cuente como deuda pendiente lo que hace rato se pagó — y un total
            que miente en ese orden de magnitud es peor que no tenerlo. */}
        <div className="field imp-desde">
          <label htmlFor="imp-desde">Importar solo desde (opcional)</label>
          <input id="imp-desde" name="desde" type="date" />
          <p className="imp-ayuda">
            Vacío entra el archivo entero. ARCA no trae si una factura ya se pagó, así que traer
            meses viejos hace que <strong>Total pendiente</strong> cuente deuda que ya no existe.
          </p>
        </div>

        <button className="btn primary" disabled={ocupado || !elegido}>
          {ocupado ? "Leyendo…" : "Ver qué va a pasar"}
        </button>
      </form>

      {error && (
        <div className="login-error imp-error">
          {error}
        </div>
      )}

      {previa && (
        <section className="imp-previa">
          <h2>Esto es lo que va a pasar</h2>
          <p className="msub">
            {previa.filasLeidas} fila{previa.filasLeidas === 1 ? "" : "s"} en el archivo
            {previa.desde ? `, del ${previa.desde} al ${previa.hasta}` : ""}
            {omitidas > 0
              ? ` · ${omitidas} más quedaron fuera por la fecha de corte`
              : ""}
            {entidades.length > 1 ? ` · ${entidadPrevia}` : ""}. Todavía no se guardó nada.
          </p>

          <ul className="imp-numeros">
            <li>
              <strong>{previa.creadas}</strong>
              <span>facturas que ARCA conoce y nadie trajo el papel</span>
            </li>
            <li>
              <strong>{previa.completadas}</strong>
              <span>ya cargadas, que se completan con el dato del fisco</span>
            </li>
            {/* Solo cuando hay. Si no, es un cero que no dice nada — pero
                cuando lo hay, es lo que hace que 741 + 1 dé las 743 filas del
                archivo y no falte ninguna sin explicación. */}
            {previa.yaEstaban > 0 && (
              <li>
                <strong>{previa.yaEstaban}</strong>
                <span>que ya estaban cargadas y coinciden</span>
              </li>
            )}
            <li>
              <strong>{previa.sinRespaldo}</strong>
              <span>que tenemos y ARCA no conoce, en ese período</span>
            </li>
          </ul>

          {previa.discrepancias.length > 0 && (
            <div className="imp-conflictos">
              <strong>
                {previa.discrepancias.length} diferencia
                {previa.discrepancias.length === 1 ? "" : "s"} contra correcciones hechas a mano.
              </strong>
              <p className="msub">
                Estos NO se pisan: quien los corrigió pudo haber visto algo que ARCA no tiene.
                Quedan anotados para revisar.
              </p>
              <ul>
                {previa.discrepancias.slice(0, 10).map((d, i) => (
                  <li key={`${d.documentId}-${d.campo}-${i}`}>
                    {d.campo}: figura <strong>{d.loCargado ?? "vacío"}</strong>, ARCA dice{" "}
                    <strong>{d.segunArca ?? "vacío"}</strong>
                  </li>
                ))}
              </ul>
              {previa.discrepancias.length > 10 && (
                <p className="msub">y {previa.discrepancias.length - 10} más.</p>
              )}
            </div>
          )}

          <Convertidas filas={convertidas} />
          <Salteadas filas={salteadas} />

          <div className="imp-acciones">
            <button className="btn primary" onClick={aplicar} disabled={ocupado}>
              {ocupado ? "Importando…" : "Importar"}
            </button>
            <button className="btn ghost" onClick={() => setPrevia(null)} disabled={ocupado}>
              Cancelar
            </button>
          </div>
        </section>
      )}

      {hecho && (
        <section className="settings-ok imp-hecho">
          <strong>Importado.</strong>{" "}
          {hecho.creadas} factura{hecho.creadas === 1 ? "" : "s"} nueva
          {hecho.creadas === 1 ? "" : "s"}, {hecho.completadas} completada
          {hecho.completadas === 1 ? "" : "s"}
          {hecho.sinRespaldo > 0 ? `, ${hecho.sinRespaldo} marcada${hecho.sinRespaldo === 1 ? "" : "s"} como no encontrada${hecho.sinRespaldo === 1 ? "" : "s"} en ARCA` : ""}.
          {hecho.creadas > 0 && " Las nuevas no tienen vencimiento cargado: ARCA no lo trae."}
          {/* Después de importar, ésta es la única línea que queda diciendo que
              el archivo tenía más filas de las que entraron. */}
          {omitidas > 0 &&
            ` Quedaron fuera ${omitidas} filas anteriores a la fecha de corte; el archivo sigue teniéndolas.`}
        </section>
      )}

      {hecho && <Convertidas filas={convertidas} />}
      {hecho && <Salteadas filas={salteadas} />}
    </div>
  );
}

/**
 * Las que venían en otra moneda.
 *
 * **Este importe no está impreso en ningún papel**: lo calculó la máquina
 * multiplicando por la cotización de la fila. Por eso se muestra la cuenta
 * entera —original, cotización y resultado— y no solo el resultado: quien mira
 * tiene que poder decir "ese número está mal" sin abrir el CSV.
 *
 * También queda anotado en el historial de cada comprobante, así que se puede
 * encontrar y deshacer más adelante.
 */
function Convertidas({ filas }: { filas: ConvertidaVisible[] }) {
  if (filas.length === 0) return null;
  return (
    <div className="imp-convertidas">
      <strong>
        {filas.length} comprobante{filas.length === 1 ? "" : "s"} en otra moneda, pasado
        {filas.length === 1 ? "" : "s"} a pesos con la cotización del archivo.
      </strong>
      <ul>
        {filas.map((f) => (
          <li key={f.linea}>
            <span className="imp-conv-quien">
              {f.emisor} · {f.fecha}
            </span>
            <span className="imp-conv-cuenta">
              {f.original} × {f.cotizacion} = <strong>{f.resultado}</strong>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Las que quedaron afuera.
 *
 * Se listan enteras, no contadas: son pocas y a cada una hay que ir a cargarla
 * a mano. Un "3 salteadas" obligaría a abrir el CSV para saber cuáles.
 */
function Salteadas({ filas }: { filas: Salteada[] }) {
  if (filas.length === 0) return null;
  return (
    <div className="imp-salteadas">
      <strong>
        {filas.length} comprobante{filas.length === 1 ? "" : "s"} que no{" "}
        {filas.length === 1 ? "entra" : "entran"}, y hay que cargar a mano.
      </strong>
      <p>
        No se pudieron convertir a pesos, y multiplicar por uno sería inventar el importe. Hay que
        cargarlas a mano.
      </p>
      <ul>
        {filas.map((f) => (
          <li key={f.linea}>
            {f.detalle} <span className="imp-linea">({f.motivo}, línea {f.linea})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
