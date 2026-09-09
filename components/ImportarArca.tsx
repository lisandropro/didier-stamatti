"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { previsualizarArca, importarArca } from "@/app/actions/comprobantes";
import type { ResultadoImportacion } from "@/lib/comprobantes/arca";

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

  async function mirar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    setHecho(null);
    setPrevia(null);
    const r = await previsualizarArca(new FormData(e.currentTarget));
    setOcupado(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPrevia(r.previa);
    setEntidadPrevia(r.entidad);
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
        </section>
      )}
    </div>
  );
}
