"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { capturarComprobante } from "@/app/actions/comprobantes";
import type { Esquina } from "@/lib/comprobantes/escaneo";
import { crearLectorQr } from "@/lib/comprobantes/lector-qr";
import { llaveDeCliente, porQueNoHayCamara } from "@/lib/llave-cliente";
import { useDeteccionViva, aEscalaDeFoto } from "./usar-deteccion-viva";
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

/**
 * Una foto de la tanda, con lo que se supo de ella al sacarla.
 *
 * Las esquinas salen del visor —que viene siguiendo el papel— así que al
 * disparar el recorte ya está decidido y **no hace falta una pantalla de
 * ajuste**. El enderezado tampoco se hace acá: se manda la foto con sus
 * esquinas y lo hace el servidor, que es lo que saca el congelamiento de uno a
 * tres segundos por foto.
 */
type Disparo = {
  blob: Blob;
  /** En coordenadas de la foto. `null` si el detector no encontró el papel:
   *  entonces se guarda sin recortar, que es mejor que recortar mal. */
  esquinas: Esquina[] | null;
  qrs: string[];
  /** Para la miniatura. Se libera al descartar la foto. */
  vista: string;
  clientKey: string;
};
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

  // La tanda: las fotos sacadas que todavía no se guardaron.
  //
  // Es el cambio estructural. Antes cada foto era un ciclo completo —abrir la
  // cámara, disparar, salir, revisar, guardar— y cinco facturas de un reparto
  // eran cinco ciclos. Ahora la cámara es la pantalla de trabajo: se dispara
  // varias veces seguidas y las fotos se acumulan.
  const [tanda, setTanda] = useState<Disparo[]>([]);

  // Cuánto de la tanda se subió, de 0 a 1. Alimenta la barra de progreso.
  const [escaneando, setEscaneando] = useState(0);

  // El marco verde que sigue al papel en el visor. Guardarlo en una ref y no en
  // estado es deliberado: se actualiza diez veces por segundo y un `setState`
  // por lectura volvería a dibujar toda la pantalla diez veces por segundo para
  // nada — el marco lo pinta su propio lienzo.
  const marcoLienzoRef = useRef<HTMLCanvasElement>(null);
  // Este SÍ es estado: cambia poco y hay que mostrarlo.
  const [consejo, setConsejo] = useState<"nada" | "buscando" | "lejos" | "listo">("buscando");

  const [destino, setDestino] = useState<Destino | null>(null);
  const [conforme, setConforme] = useState<boolean | null>(null);
  const [codigoLeido, setCodigoLeido] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);

  const deteccionRef = useDeteccionViva(videoRef, marcoLienzoRef, paso === "camara", (e) => {
    setConsejo(!e.cuadro ? "buscando" : e.lejos ? "lejos" : "listo");
  });

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

  // Las vistas previas viven en cada foto de la tanda, no en una sola variable:
  // ahora puede haber varias sin guardar a la vez. Se liberan al descartar una
  // foto y al terminar de subir la tanda.

  async function abrirCamara() {
    // Entre el toque y el diálogo de permiso pasan segundos sin ninguna señal,
    // así que la persona vuelve a tocar. Sin esta guarda el segundo stream pisa
    // al primero y el primero queda encendido para siempre.
    if (abriendo.current) return;
    abriendo.current = true;

    // **TODO va adentro del `try`.** Antes la preparación estaba afuera, y
    // cuando algo de ahí tiraba —`crypto.randomUUID()` no existe fuera de un
    // contexto seguro— la excepción se llevaba puesto este `finally`.
    // `abriendo.current` quedaba en `true` para siempre y **todos los toques
    // siguientes salían por el `return` de arriba**: un botón que no hace nada,
    // sin un solo mensaje. Lo reportó alguien usándolo desde el teléfono.
    try {
      // Antes de pedir permiso: si el navegador directamente no puede, decir por
      // qué. "No se pudo abrir la cámara" manda a revisar permisos cuando el
      // problema es la dirección.
      const impedimento = porQueNoHayCamara();
      if (impedimento) {
        setError(impedimento);
        return;
      }

      cerrarCamara();
      setError(null);
      setAviso(null);
      // La llave se genera acá, al abrir la cámara y no al enviar: es lo que
      // hace que un doble toque nervioso no cree dos comprobantes.
      clientKeyRef.current = llaveDeCliente();
      qrRef.current = new Set();
      setCodigoLeido(false);
      setDestino(null);
      setConforme(null);

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
              // El mensaje ahora incluye el detalle: un error mudo es lo que
              // hizo falta media hora de investigación la primera vez.
              : `No se pudo abrir la cámara${nombre ? ` (${nombre})` : ""}. Probá de nuevo.`,
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

    // **Las esquinas ya están.** El visor viene siguiendo el papel, así que al
    // disparar no hay nada que calcular ni que preguntar: se llevan las que
    // estaban dibujadas, escaladas al tamaño de la foto.
    const detectado = deteccionRef.current.cuadro;
    const esquinas = detectado ? aEscalaDeFoto(detectado, video.videoWidth, lienzo.width) : null;

    // Y **NO se sale de la cámara**. La foto se apila y se puede sacar la
    // siguiente enseguida: un reparto son cinco comprobantes, no uno.
    setTanda((prev) => [
      ...prev,
      {
        blob,
        esquinas,
        qrs: [...qrRef.current],
        vista: URL.createObjectURL(blob),
        // Una llave por foto: es lo que impide que un doble toque nervioso o un
        // reintento cree dos comprobantes de la misma.
        clientKey: llaveDeCliente(),
      },
    ]);

    // El lector de QR arranca de cero para la foto siguiente.
    qrRef.current = new Set();
    setCodigoLeido(false);
  }

  /**
   * Sube toda la tanda.
   *
   * Una llamada por comprobante —cada uno es su propio documento— pero **una
   * sola vez las preguntas**: el destino de un reparto es siempre el mismo, y
   * contestarlo cinco veces era la mitad de los toques.
   *
   * El enderezado NO se hace acá: se mandan la foto y sus esquinas, y lo hace el
   * servidor. Medido a la resolución real de captura, hacerlo en el teléfono
   * costaba 1,2 s de media y 1,8 s el peor caso — por foto.
   */
  async function guardar() {
    if (tanda.length === 0) return;
    setPaso("guardando");
    setError(null);

    const nuevas: CapturaDelDia[] = [];
    for (const [i, d] of tanda.entries()) {
      setEscaneando((i + 1) / tanda.length);

      const fd = new FormData();
      fd.set("clientKey", d.clientKey);
      fd.set("kind", "FACTURA");
      fd.append("fotos", new File([d.blob], "comprobante.jpg", { type: "image/jpeg" }));
      fd.append("variante", "ORIGINAL");
      fd.append("pagina", "1");
      // Las esquinas viajan con la foto. Sin ellas el servidor guarda la
      // original sin recortar, que es lo correcto: recortar mal es peor.
      fd.append("esquinas", d.esquinas ? JSON.stringify(d.esquinas) : "");
      for (const qr of d.qrs) fd.append("qr", qr);
      if (destino) fd.set("destino", destino);
      if (conforme !== null) fd.set("conforme", conforme ? "si" : "no");

      let r;
      try {
        r = await capturarComprobante(fd);
      } catch {
        // Con la red caída la promesa se rechaza. Sin esto la pantalla se queda
        // en el esqueleto para siempre, con la única salida de recargar — que
        // además borra las fotos.
        //
        // Las que ya subieron se sacan de la tanda: reintentar no puede volver a
        // mandarlas. Las que faltan quedan, y "Guardar" sigue disponible.
        setTanda((prev) => prev.slice(nuevas.length));
        setCapturas((prev) => [...nuevas, ...prev]);
        setError(
          nuevas.length > 0
            ? `Se guardaron ${nuevas.length} de ${tanda.length}. Se cortó la conexión: las que faltan siguen acá.`
            : "No se pudo enviar. Las fotos siguen acá: revisá la señal y tocá Guardar de nuevo.",
        );
        setPaso("revision");
        return;
      }

      if (!r.ok) {
        setTanda((prev) => prev.slice(nuevas.length));
        setCapturas((prev) => [...nuevas, ...prev]);
        setError(r.error ?? "No se pudo guardar. Las fotos siguen acá, probá de nuevo.");
        setPaso("revision");
        return;
      }

      if (r.aviso) setAviso(r.aviso);
      nuevas.push({
        id: r.documentId!,
        kind: "FACTURA",
        proveedor: null,
        destino,
        conforme,
        identificado: d.qrs.length > 0,
        hora: new Date().toISOString(),
      });
    }

    for (const d of tanda) URL.revokeObjectURL(d.vista);
    setCapturas((prev) => [...nuevas, ...prev]);
    setTanda([]);
    setEscaneando(0);
    setPaso("listo");
  }

  /** Descarta una foto de la tanda. Sale mal seguido: una queda movida, otra
   *  salió del mismo comprobante dos veces. */
  function descartar(clientKey: string) {
    setTanda((prev) => {
      const d = prev.find((x) => x.clientKey === clientKey);
      if (d) URL.revokeObjectURL(d.vista);
      return prev.filter((x) => x.clientKey !== clientKey);
    });
  }

  // --- Cámara: pantalla completa, controles abajo ---------------------------
  if (paso === "camara") {
    return (
      <div className="cap-camara">
        <video ref={videoRef} className="cap-video" playsInline muted />
        {/* El marco del papel, dibujado en vivo. Reemplaza al recuadro fijo que
            había antes: aquel decía "poné el papel más o menos acá" y éste dice
            "encontré el papel, es esto". Cuando disparás, el recorte ya está
            decidido — por eso deja de hacer falta una pantalla de ajuste. */}
        <canvas ref={marcoLienzoRef} className="cap-marco-vivo" aria-hidden />
        <p className="cap-estado" role="status">
          {codigoLeido
            ? "Código leído"
            : consejo === "listo"
              ? "Listo para sacar"
              : consejo === "lejos"
                ? "Acercate un poco"
                : "Apuntá al comprobante"}
        </p>
        {/* Las fotos de la tanda, en una tira sobre los controles. Es lo que
            dice "van tres" sin contar nada, y lo que permite descartar la que
            salió movida sin salir de la cámara. */}
        {tanda.length > 0 && (
          <div className="cap-tira" role="list" aria-label={`${tanda.length} fotos sacadas`}>
            {tanda.map((d, i) => (
              <button
                key={d.clientKey}
                type="button"
                className="cap-mini"
                role="listitem"
                onClick={() => descartar(d.clientKey)}
                aria-label={`Descartar la foto ${i + 1}`}
                title="Descartar"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.vista} alt="" />
                <span className="cap-mini-x" aria-hidden>×</span>
              </button>
            ))}
          </div>
        )}

        <div className="cap-controles">
          <button
            type="button"
            className="cap-cancelar"
            onClick={() => {
              cerrarCamara();
              for (const d of tanda) URL.revokeObjectURL(d.vista);
              setTanda([]);
              setPaso("inicio");
            }}
          >
            Cancelar
          </button>
          <button type="button" className="cap-disparo" onClick={disparar} aria-label="Sacar la foto" />

          {/* "Listo" aparece recién cuando hay algo que guardar. Antes ese lugar
              estaba vacío, y un botón que aparece cuando sirve se encuentra
              mejor que uno que está siempre y a veces no hace nada. */}
          {tanda.length > 0 ? (
            <button
              type="button"
              className="cap-listo-btn"
              onClick={() => {
                cerrarCamara();
                setPaso("revision");
              }}
            >
              Listo
              <span className="cap-cuenta">{tanda.length}</span>
            </button>
          ) : (
            <span className="cap-hueco" aria-hidden />
          )}
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

      {paso === "revision" && tanda.length > 0 && (
        <section className="cap-revision">
          {/* Las fotos de la tanda, para mirarlas antes de guardar. Ya vienen
              recortadas por el visor: acá no hay nada que ajustar, solo que
              mirar y descartar la que salió mal. */}
          <div className="cap-grilla" role="list">
            {tanda.map((d, i) => (
              <div key={d.clientKey} className="cap-grilla-item" role="listitem">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.vista} alt={`Comprobante ${i + 1}`} />
                <button
                  type="button"
                  className="cap-quitar"
                  onClick={() => descartar(d.clientKey)}
                  aria-label={`Descartar el comprobante ${i + 1}`}
                >
                  Quitar
                </button>
                {!d.esquinas && (
                  <span className="cap-sin-recorte-aviso" title="No se encontró el borde del papel">
                    sin recortar
                  </span>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            className="btn ghost cap-sumar"
            onClick={() => {
              setPaso("camara");
              abrirCamara();
            }}
          >
            Sacar otra
          </button>

          {/* **Una vez por tanda, no una por foto.** El destino de un reparto es
              siempre el mismo, y contestarlo cinco veces era la mitad de los
              toques. */}
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
              Guardar {tanda.length === 1 ? "el comprobante" : `los ${tanda.length}`}
            </button>
            {/* Las dos preguntas son salteables a propósito: el día que llegan
                tres proveedores juntos es el día que se abandona una app que
                obliga a contestarlas. */}
            <p className="hint">Las dos preguntas se pueden saltear. Lo que importa es que las fotos queden.</p>
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
