"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { capturarComprobante } from "@/app/actions/comprobantes";
import type { CapturaDelDia } from "@/lib/comprobantes/documentos";

// La pantalla del depósito. Una sola cosa: sacar la foto.
//
// Tres decisiones que salen de dónde se usa y no de cómo queda:
//
// 1. **Los controles van abajo.** Se sostiene el teléfono con una mano y una
//    caja con la otra; arriba no llega el pulgar.
// 2. **Nunca aparece un importe.** El servidor no lo manda, y la pantalla
//    tampoco tiene dónde ponerlo. Quien recibe no maneja plata.
// 3. **Guardar nunca se bloquea.** Si el código no se leyó, si no se eligió
//    destino, si no se marcó conformidad: la foto se guarda igual. Un papel
//    fotografiado y sin identificar ya es mejor que un papel sobre un escritorio.

type Paso = "inicio" | "camara" | "revision" | "guardando" | "listo";
type Destino = "COCINA" | "DEPOSITO";

const MAX_LADO = 2000;
const MS_BUSCANDO_CODIGO = 3000;

export default function CapturaCliente({
  capturasIniciales,
}: {
  capturasIniciales: CapturaDelDia[];
}) {
  const [paso, setPaso] = useState<Paso>("inicio");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [capturas, setCapturas] = useState(capturasIniciales);

  const [foto, setFoto] = useState<Blob | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [destino, setDestino] = useState<Destino | null>(null);
  const [conforme, setConforme] = useState<boolean | null>(null);
  const [codigoLeido, setCodigoLeido] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const qrRef = useRef<Set<string>>(new Set());
  const clientKeyRef = useRef<string>("");

  const cerrarCamara = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => cerrarCamara, [cerrarCamara]);

  // La vista previa se libera al cambiar de foto: sin esto cada captura deja un
  // blob colgado en memoria, y en una jornada larga son decenas.
  useEffect(() => {
    if (!foto) return;
    const url = URL.createObjectURL(foto);
    setVistaPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  async function abrirCamara() {
    setError(null);
    setAviso(null);
    // La llave se genera acá, al abrir la cámara y no al enviar: es lo que hace
    // que un doble toque nervioso no cree dos comprobantes.
    clientKeyRef.current = crypto.randomUUID();
    qrRef.current = new Set();
    setCodigoLeido(false);
    setDestino(null);
    setConforme(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
      });
      streamRef.current = stream;
      setPaso("camara");
      // El video se monta con el paso; se conecta en el efecto de abajo.
    } catch {
      setError("No se pudo abrir la cámara. Revisá los permisos del navegador.");
    }
  }

  useEffect(() => {
    if (paso !== "camara" || !streamRef.current || !videoRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    video.play().catch(() => {});

    // La linterna, si el teléfono la expone. Un depósito no tiene buena luz y
    // es la diferencia entre leer el código y no leerlo.
    const track = streamRef.current.getVideoTracks()[0];
    try {
      track?.applyConstraints({ advanced: [{ torch: true } as never] });
    } catch {
      /* muchos teléfonos no la tienen; no es motivo para frenar nada */
    }

    const Detector = (window as unknown as { BarcodeDetector?: new (o: unknown) => { detect(s: unknown): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector) return; // sin lector, se saca la foto igual
    const detector = new Detector({ formats: ["qr_code"] });

    let vivo = true;
    const arranque = performance.now();
    async function buscar() {
      if (!vivo) return;
      // A los tres segundos se deja de insistir. No hay que pelearse con un
      // papel arrugado: la foto se saca igual y el código se resuelve después.
      if (performance.now() - arranque > MS_BUSCANDO_CODIGO) return;
      try {
        for (const c of await detector.detect(video)) {
          if (qrRef.current.has(c.rawValue)) continue;
          // Una foto puede traer varios QR —el de AFIP, uno de marketing—; se
          // juntan todos y cuál es cuál lo decide el servidor.
          qrRef.current.add(c.rawValue);
          setCodigoLeido(true);
          navigator.vibrate?.(60);
        }
      } catch {
        /* un cuadro borroso no es un error: se prueba con el siguiente */
      }
      requestAnimationFrame(buscar);
    }
    requestAnimationFrame(buscar);
    return () => {
      vivo = false;
    };
  }, [paso]);

  async function disparar() {
    const video = videoRef.current;
    if (!video) return;
    // Se reduce DESPUÉS de leer el código: comprimir antes es la forma más
    // fácil de arruinar un QR que se leía bien.
    const escala = Math.min(1, MAX_LADO / Math.max(video.videoWidth, video.videoHeight));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(video.videoWidth * escala);
    lienzo.height = Math.round(video.videoHeight * escala);
    lienzo.getContext("2d")!.drawImage(video, 0, 0, lienzo.width, lienzo.height);

    const blob = await new Promise<Blob | null>((r) => lienzo.toBlob(r, "image/jpeg", 0.85));
    if (!blob) {
      setError("No se pudo tomar la foto. Probá de nuevo.");
      return;
    }
    navigator.vibrate?.(30);
    cerrarCamara();
    setFoto(blob);
    setPaso("revision");
  }

  async function guardar() {
    if (!foto) return;
    setPaso("guardando");
    setError(null);

    const fd = new FormData();
    fd.set("clientKey", clientKeyRef.current);
    fd.set("kind", "FACTURA");
    fd.append("fotos", new File([foto], "comprobante.jpg", { type: "image/jpeg" }));
    fd.append("variante", "ORIGINAL");
    fd.append("pagina", "1");
    for (const qr of qrRef.current) fd.append("qr", qr);
    if (destino) fd.set("destino", destino);
    if (conforme !== null) fd.set("conforme", conforme ? "si" : "no");

    const r = await capturarComprobante(fd);
    if (!r.ok) {
      setError(r.error ?? "No se pudo guardar.");
      setPaso("revision");
      return;
    }
    setAviso(r.aviso ?? null);
    setCapturas((prev) => [
      {
        id: r.documentId!,
        kind: "FACTURA",
        proveedor: null,
        destino,
        conforme,
        identificado: qrRef.current.size > 0,
        hora: new Date().toISOString(),
      },
      ...prev,
    ]);
    setFoto(null);
    setPaso("listo");
  }

  // --- Cámara: pantalla completa, controles abajo ---------------------------
  if (paso === "camara") {
    return (
      <div className="cap-camara">
        <video ref={videoRef} className="cap-video" playsInline muted />
        <div className={`cap-marco${codigoLeido ? " leido" : ""}`} aria-hidden />
        <p className="cap-estado" role="status">
          {codigoLeido ? "Código leído" : "Apuntá al comprobante"}
        </p>
        <div className="cap-controles">
          <button
            type="button"
            className="cap-cancelar"
            onClick={() => {
              cerrarCamara();
              setPaso("inicio");
            }}
          >
            Cancelar
          </button>
          <button type="button" className="cap-disparo" onClick={disparar} aria-label="Sacar la foto" />
          <span className="cap-hueco" aria-hidden />
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="topbar">
        <h1>Recepción</h1>
      </header>

      {error && <p className="cap-error" role="alert">{error}</p>}

      {paso === "revision" && vistaPrevia && (
        <section className="cap-revision">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={vistaPrevia} alt="El comprobante que acabás de fotografiar" className="cap-previa" />

          <p className={`cap-lectura${codigoLeido ? " ok" : ""}`}>
            {codigoLeido
              ? "Se leyó el código del comprobante."
              : "No se leyó el código. Se guarda igual y se completa después."}
          </p>

          <fieldset className="cap-grupo">
            <legend>¿A dónde entró?</legend>
            <div className="cap-opciones">
              {(["COCINA", "DEPOSITO"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`cap-opcion${destino === d ? " elegida" : ""}`}
                  aria-pressed={destino === d}
                  onClick={() => setDestino(destino === d ? null : d)}
                >
                  {d === "COCINA" ? "Cocina" : "Depósito"}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="cap-grupo">
            <legend>¿Llegó todo?</legend>
            <div className="cap-opciones">
              <button
                type="button"
                className={`cap-opcion${conforme === true ? " elegida" : ""}`}
                aria-pressed={conforme === true}
                onClick={() => setConforme(conforme === true ? null : true)}
              >
                Sí
              </button>
              <button
                type="button"
                className={`cap-opcion${conforme === false ? " elegida" : ""}`}
                aria-pressed={conforme === false}
                onClick={() => setConforme(conforme === false ? null : false)}
              >
                Faltan cosas
              </button>
            </div>
          </fieldset>

          <div className="cap-cierre">
            <button type="button" className="btn primary cap-guardar" onClick={guardar}>
              Guardar
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setFoto(null);
                abrirCamara();
              }}
            >
              Sacar de nuevo
            </button>
            {/* Las dos preguntas son salteables a propósito: el día que llegan
                tres proveedores juntos es el día que se abandona una app que
                obliga a contestarlas. */}
            <p className="hint">Las dos preguntas se pueden saltear. Lo que importa es que la foto quede.</p>
          </div>
        </section>
      )}

      {paso === "guardando" && (
        <section className="cap-revision" aria-busy="true">
          <div className="sk cap-previa" />
          <div className="sk" style={{ height: 14, width: "60%" }} />
        </section>
      )}

      {(paso === "inicio" || paso === "listo") && (
        <div className="cap-recepcion">
          {paso === "listo" && (
            <p className="cap-listo" role="status">
              <span className="cap-tilde" aria-hidden>✓</span>
              Listo. Aldana ya lo ve.
            </p>
          )}
          {aviso && <p className="cap-aviso" role="status">{aviso}</p>}

          <h2 className="section-title">Lo que cargué hoy</h2>
          {capturas.length === 0 ? (
            <div className="empty-card">
              <p>Todavía no cargaste nada hoy.</p>
              <p className="hint">
                Cada comprobante que llega con la mercadería: facturas, remitos y tickets.
              </p>
            </div>
          ) : (
            <ul className="cap-lista">
              {capturas.map((c) => (
                <li key={c.id} className="cap-item">
                  <span className="cap-item-hora">{hora(c.hora)}</span>
                  <span className="cap-item-nombre">
                    {c.proveedor ?? (c.identificado ? "Comprobante leído" : "Sin identificar")}
                  </span>
                  <span className="cap-item-meta">
                    {c.destino === "COCINA" ? "Cocina" : c.destino === "DEPOSITO" ? "Depósito" : "—"}
                    {c.conforme === false && " · faltaban cosas"}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Último en el orden del documento y anclado abajo: es la única
              acción de la pantalla y tiene que estar bajo el pulgar. */}
          <button type="button" className="cap-arranque" onClick={abrirCamara}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            Recibí mercadería
          </button>
        </div>
      )}
    </>
  );
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}
