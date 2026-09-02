"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { capturarComprobante } from "@/app/actions/comprobantes";
import Recorte from "./recorte";
import { escanear, type Esquina } from "@/lib/comprobantes/escaneo";
import { crearLectorQr } from "@/lib/comprobantes/lector-qr";
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

/**
 * El lado más largo de la foto que se guarda.
 *
 * **3000 y no 2000, y el número está medido.** Contra las 18 fotos reales del
 * depósito, decodificando con zxing:
 *
 *     1600 px → 1 de 18 QR legibles
 *     2000 px → 3 de 18        ← lo que había
 *     2400 px → 4 de 18
 *     2800 px → 6 de 18
 *     3200 px → 7 de 18
 *     nativo  → 5 de 18
 *
 * O sea que el achicado del disparo estaba tirando más de la mitad de los
 * códigos **antes de que existiera el escaneo**, y en silencio: un QR que no se
 * lee es indistinguible de un comprobante que no lo trae.
 *
 * Que el nativo rinda peor que 3200 no es un error de medición: un achicado
 * suave promedia el ruido del sensor y le deja los bordes más limpios al
 * decodificador.
 *
 * Cuesta el doble de peso —alrededor de 1 MB por foto contra 500 KB— y lo vale:
 * un QR perdido manda el comprobante a carga manual, que es exactamente lo que
 * este módulo vino a evitar.
 */
const MAX_LADO = 3000;
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
  // El lienzo de la foto, para poder recortarla. Se guarda aparte del blob
  // porque volver a decodificar el JPEG para recortar pierde calidad dos veces.
  const [lienzoFoto, setLienzoFoto] = useState<HTMLCanvasElement | null>(null);
  const esquinasRef = useRef<Esquina[] | null>(null);
  const [recortar, setRecortar] = useState(true);
  const [giro, setGiro] = useState<0 | 90 | 180 | 270>(0);
  const [escaneando, setEscaneando] = useState(0);
  const [destino, setDestino] = useState<Destino | null>(null);
  const [conforme, setConforme] = useState<boolean | null>(null);
  const [codigoLeido, setCodigoLeido] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const avisoError = useRef<HTMLParagraphElement>(null);
  const abriendo = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const qrRef = useRef<Set<string>>(new Set());
  const clientKeyRef = useRef<string>("");

  const cerrarCamara = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => cerrarCamara, [cerrarCamara]);

  // El botón Guardar está al pie de la revisión y el error se pinta arriba:
  // sin esto la persona toca Guardar, no ve nada, y vuelve a tocar.
  useEffect(() => {
    if (!error) return;
    avisoError.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    avisoError.current?.focus();
  }, [error]);

  // La vista previa se DERIVA de la foto, no se guarda aparte. Crearla dentro
  // de un efecto obligaba a un render de mas —la pantalla se dibujaba una vez
  // sin imagen y otra con ella— y en un telefono viejo ese parpadeo se ve.
  const vistaPrevia = useMemo(() => (foto ? URL.createObjectURL(foto) : null), [foto]);

  // Y se libera al cambiar de foto: sin esto cada captura deja un blob colgado
  // en memoria, y en una jornada larga son decenas.
  useEffect(() => {
    if (!vistaPrevia) return;
    return () => URL.revokeObjectURL(vistaPrevia);
  }, [vistaPrevia]);

  async function abrirCamara() {
    // Entre el toque y el diálogo de permiso pasan segundos sin ninguna señal,
    // así que la persona vuelve a tocar. Sin esta guarda el segundo stream pisa
    // al primero y el primero queda encendido para siempre.
    if (abriendo.current) return;
    abriendo.current = true;
    cerrarCamara();
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
    } catch (e) {
      const nombre = e instanceof Error ? e.name : "";
      setError(
        nombre === "NotAllowedError"
          ? "La cámara está bloqueada. Tocá el candado al lado de la dirección, entrá a Permisos y permití la cámara."
          : nombre === "NotReadableError"
            ? "Otra app está usando la cámara. Cerrá WhatsApp o la cámara del teléfono y volvé a intentar."
            : nombre === "NotFoundError"
              ? "Este dispositivo no tiene cámara."
              : "No se pudo abrir la cámara. Probá de nuevo.",
      );
    } finally {
      abriendo.current = false;
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

    let vivo = true;
    const arranque = performance.now();

    // El lector se elige al vuelo: nativo donde existe, jsQR donde no. Antes
    // acá había un `if (!BarcodeDetector) return`, y en iPhone —que es lo que
    // este equipo usa— esa rama se tomaba SIEMPRE, en silencio.
    crearLectorQr().then((lector) => {
      if (!lector || !vivo) return;

      async function buscar() {
        if (!vivo) return;
        // A los tres segundos se deja de insistir. No hay que pelearse con un
        // papel arrugado: la foto se saca igual y el código se resuelve después.
        if (performance.now() - arranque > MS_BUSCANDO_CODIGO) return;
        for (const valor of await lector!.leer(video!)) {
          if (qrRef.current.has(valor)) continue;
          // Una foto puede traer varios QR —el de AFIP, uno de marketing—; se
          // juntan todos y cuál es cuál lo decide el servidor.
          qrRef.current.add(valor);
          setCodigoLeido(true);
          navigator.vibrate?.(60);
        }
        requestAnimationFrame(buscar);
      }
      requestAnimationFrame(buscar);
    });
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
    setLienzoFoto(lienzo);
    esquinasRef.current = null;
    setRecortar(true);
    setGiro(0);
    setPaso("revision");
  }

  async function guardar() {
    if (!foto) return;
    setPaso("guardando");
    setError(null);

    const fd = new FormData();
    fd.set("clientKey", clientKeyRef.current);
    fd.set("kind", "FACTURA");

    // La ORIGINAL va SIEMPRE y va primero. Es el seguro: lo que se archiva es
    // la escaneada, pero si el recorte se comio un borde, el papel de verdad
    // sigue estando.
    fd.append("fotos", new File([foto], "comprobante.jpg", { type: "image/jpeg" }));
    fd.append("variante", "ORIGINAL");
    fd.append("pagina", "1");

    // Y la escaneada, si se pudo. **Si falla no pasa nada**: se sube solo la
    // original y el comprobante entra igual. Vale la regla del modulo — nada
    // puede impedir que la foto quede.
    if (recortar && lienzoFoto && esquinasRef.current) {
      const escaneada = await escanear(lienzoFoto, esquinasRef.current, {
        giro,
        alAvanzar: setEscaneando,
      });
      if (escaneada) {
        fd.append("fotos", new File([escaneada], "escaneada.jpg", { type: "image/jpeg" }));
        fd.append("variante", "ESCANEADA");
        fd.append("pagina", "1");
      }
    }

    for (const qr of qrRef.current) fd.append("qr", qr);
    if (destino) fd.set("destino", destino);
    if (conforme !== null) fd.set("conforme", conforme ? "si" : "no");

    let r;
    try {
      r = await capturarComprobante(fd);
    } catch {
      // Sin esto, con la red caída la promesa se rechaza, no corre ni setError
      // ni setPaso, y la pantalla queda en el esqueleto para siempre — con la
      // única salida de recargar, que además borra la foto.
      setError("No se pudo enviar. La foto sigue acá: revisá la señal y tocá Guardar de nuevo.");
      setPaso("revision");
      return;
    }
    if (!r.ok) {
      setError(r.error ?? "No se pudo guardar. La foto sigue acá, probá de nuevo.");
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
    // `.content` es el envoltorio que usa toda la app: aporta el padding y los
    // 92px de fondo que despejan la barra de navegación. Sin él, el botón
    // principal quedaba DETRÁS de la barra y tocarlo abría "Avisos".
    <>
      <header className="topbar">
        <h1>Recepción</h1>
      </header>
      <div className="content">

      {error && (
        <p className="cap-error" role="alert" ref={avisoError}>
          {error}
        </p>
      )}

      {paso === "revision" && vistaPrevia && (
        <section className="cap-revision">
          {recortar && lienzoFoto ? (
            <Recorte
              fuente={lienzoFoto}
              giro={giro}
              onGirar={() => setGiro((g) => ((g + 90) % 360) as 0 | 90 | 180 | 270)}
              onCambio={(e) => {
                esquinasRef.current = e;
              }}
            />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={vistaPrevia} alt="El comprobante que acabás de fotografiar" className="cap-previa" />
          )}

          {/* Siempre visible, siempre disponible: si el recorte no ayuda, se
              sale de él en un toque y la foto se guarda como está. */}
          {lienzoFoto && (
            <button type="button" className="btn ghost cap-sin-recorte" onClick={() => setRecortar((v) => !v)}>
              {recortar ? "Usar la foto sin recortar" : "Recortar el papel"}
            </button>
          )}

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
          {/* El escaneo tarda segundos a resolución completa. Sin esta barra la
              pantalla se ve congelada y quien saca la foto vuelve a tocar. */}
          {escaneando > 0 && escaneando < 1 && (
            <p className="cap-progreso" role="status">
              Enderezando el papel… {Math.round(escaneando * 100)}%
            </p>
          )}
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
      </div>
    </>
  );
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}
