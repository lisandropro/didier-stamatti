"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { intentar } from "@/lib/actualizacion";
import { MensajeDeError } from "@/components/Formulario";

/**
 * La base de todas las ventanas de la app (las "hojas" del celular).
 *
 * Antes cada ventana repetía su propio fondo y su propio cierre, y cada una se
 * olvidaba de algo distinto: Escape cerraba unas y otras no, el fondo
 * scrolleaba detrás de unas y no de otras, con el teclado se podía tabular a lo
 * que quedaba tapado, y tocar afuera tiraba lo tipeado sin preguntar.
 *
 * El DOM y las clases son los de siempre (`.overlay > .modal`, con
 * `data-sin-deslizar` en las de formulario): de eso dependen la hoja de estilos
 * y el gesto de deslizar para cerrar de `ComportamientoDeApp`, que al soltar
 * hace clic en el fondo. Ese clic entra por el mismo cierre que tocar afuera,
 * así que respeta las mismas reglas.
 *
 * Lo que agrega, en un solo lugar:
 *  - `role="dialog"`, `aria-modal` y nombre accesible (el título).
 *  - Escape cierra, esté donde esté el foco.
 *  - El fondo no scrollea mientras la ventana está abierta.
 *  - El foco entra a la ventana, no se escapa con Tab, y al cerrar vuelve a
 *    donde estaba.
 *  - `ocupado`: mientras se guarda, ni el fondo ni Escape la cierran.
 *  - `cambiado`: si hay algo tipeado, cerrar por el fondo o con Escape pregunta
 *    antes de descartarlo. El botón "Cancelar" de cada ventana no pregunta: es
 *    un cierre a propósito.
 */

/** Las ventanas abiertas, de la más vieja a la más nueva: Escape y el foco son
 *  de la de arriba. */
const pila: symbol[] = [];
/** Cuántas ventanas piden el fondo quieto. Con un contador, cerrar una no
 *  destraba el fondo si queda otra abierta. */
let trabas = 0;
let estiloPrevio: { overflow: string; paddingRight: string } | null = null;

function trabarFondo() {
  if (trabas++ > 0) return;
  const body = document.body;
  estiloPrevio = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  // En la computadora, sacar la barra de scroll corre toda la pantalla unos
  // píxeles: se compensa con un relleno del mismo ancho. En el celular vale 0.
  const barra = window.innerWidth - document.documentElement.clientWidth;
  if (barra > 0) body.style.paddingRight = `${barra}px`;
  body.style.overflow = "hidden";
}
function destrabarFondo() {
  if (--trabas > 0) return;
  trabas = 0;
  document.body.style.overflow = estiloPrevio?.overflow ?? "";
  document.body.style.paddingRight = estiloPrevio?.paddingRight ?? "";
  estiloPrevio = null;
}

const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialogo({
  titulo,
  etiqueta,
  onCerrar,
  ocupado = false,
  cambiado = false,
  sinDeslizar = false,
  ancho,
  className,
  alEnviar,
  children,
}: {
  /** El título visible (un `<h2>`), que además le da nombre a la ventana. */
  titulo?: ReactNode;
  /** Nombre accesible para las ventanas que dibujan su propio título. */
  etiqueta?: string;
  onCerrar: () => void;
  /** Guardando: el fondo y Escape no cierran. */
  ocupado?: boolean;
  /** Hay algo tipeado: el fondo y Escape preguntan antes de descartar. */
  cambiado?: boolean;
  /** Las hojas de formulario no se cierran deslizando (`data-sin-deslizar`). */
  sinDeslizar?: boolean;
  ancho?: "wide" | "xwide";
  /** Clases extra de la hoja (`modal-sheet`, `sug-modal`). */
  className?: string;
  /** Si es un formulario: lo que hace Enter (y el botón `type="submit"`). */
  alEnviar?: () => void;
  children: ReactNode;
}) {
  const idTitulo = useId();
  const hoja = useRef<HTMLDivElement>(null);
  // Dónde estaba el foco al abrir: se lee al dibujar por primera vez, antes de
  // que un `autoFocus` de adentro se lo lleve.
  const [volverA] = useState<Element | null>(() => (typeof document === "undefined" ? null : document.activeElement));
  const [marca] = useState(() => Symbol("dialogo"));
  const [preguntando, setPreguntando] = useState(false);
  // El clic en el fondo solo cuenta si también empezó en el fondo: arrastrar
  // para seleccionar un texto y soltar afuera no es querer cerrar.
  const empezoEnElFondo = useRef(false);

  // En referencias: los manejadores del documento se arman una sola vez y
  // tienen que ver siempre el último valor.
  const estado = useRef({ ocupado, cambiado, onCerrar });
  useEffect(() => {
    estado.current = { ocupado, cambiado, onCerrar };
  });

  /** El cierre "sin querer": fondo, Escape o deslizar. */
  const pedirCierre = useCallback(() => {
    const e = estado.current;
    if (e.ocupado) return;
    if (e.cambiado) return setPreguntando(true);
    e.onCerrar();
  }, []);

  useEffect(() => {
    pila.push(marca);
    trabarFondo();
    // Si nada de adentro pidió el foco, lo toma la hoja: el lector de pantalla
    // anuncia la ventana y Tab arranca adentro. No se enfoca un campo por las
    // dudas: en el celular eso levanta el teclado.
    const nodo = hoja.current;
    if (nodo && !nodo.contains(document.activeElement)) nodo.focus({ preventScroll: true });

    const alTeclear = (e: KeyboardEvent) => {
      if (pila[pila.length - 1] !== marca) return;
      const dentro = hoja.current;
      if (!dentro) return;
      if (e.key === "Escape") {
        // Si algo de adentro ya usó el Escape (cancelar una edición en línea,
        // cerrar un menú), lo marca con preventDefault y acá no se cierra.
        if (e.defaultPrevented) return;
        e.preventDefault();
        pedirCierre();
        return;
      }
      if (e.key !== "Tab") return;
      const lista = [...dentro.querySelectorAll<HTMLElement>(ENFOCABLES)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (lista.length === 0) {
        e.preventDefault();
        dentro.focus({ preventScroll: true });
        return;
      }
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      const actual = document.activeElement;
      if (!dentro.contains(actual) || actual === dentro) {
        e.preventDefault();
        (e.shiftKey ? ultimo : primero).focus();
      } else if (e.shiftKey && actual === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && actual === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    // En `window` y no en `document`: así corre después de los manejadores de
    // React, y lo que ya usó el Escape llega marcado.
    window.addEventListener("keydown", alTeclear);
    return () => {
      window.removeEventListener("keydown", alTeclear);
      const i = pila.indexOf(marca);
      if (i !== -1) pila.splice(i, 1);
      destrabarFondo();
      // El foco vuelve a quien abrió la ventana. Un instante después y no acá
      // mismo: en desarrollo React desmonta y vuelve a montar cada efecto, y
      // devolver el foco en ese falso cierre se lo sacaba al campo con
      // `autoFocus`. Para cuando corre el reloj, una ventana que sigue abierta
      // ya está otra vez en la pila. Tampoco se le saca el foco a quien lo haya
      // tomado mientras tanto (otra ventana que se abrió, la pantalla nueva).
      setTimeout(() => {
        if (pila.includes(marca)) return;
        const actual = document.activeElement;
        if (actual && actual !== document.body) return;
        if (volverA instanceof HTMLElement && volverA.isConnected) volverA.focus({ preventScroll: true });
      }, 0);
    };
  }, [marca, pedirCierre, volverA]);

  // Las ventanas de varios pasos cambian todo su contenido: si el botón que
  // tenía el foco desapareció, el foco cae en el <body> y Tab arrancaría afuera.
  useEffect(() => {
    if (pila[pila.length - 1] !== marca) return;
    const nodo = hoja.current;
    if (nodo && !nodo.contains(document.activeElement)) nodo.focus({ preventScroll: true });
  });

  const clases = `modal${ancho ? ` modal-${ancho}` : ""}${className ? ` ${className}` : ""}`;
  const cuerpo = (
    <>
      {children}
      {preguntando && (
        <div className="dialogo-descartar" role="alert">
          <span>¿Cerrar sin guardar? Se pierde lo que escribiste.</span>
          <button type="button" className="btn ghost" onClick={() => setPreguntando(false)} autoFocus>
            Seguir editando
          </button>
          <button type="button" className="btn danger" onClick={onCerrar}>
            Descartar
          </button>
        </div>
      )}
    </>
  );

  return (
    <div
      className="overlay"
      onPointerDown={(e) => {
        empezoEnElFondo.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // El clic "de verdad" tiene que haber empezado en el fondo. El que hace
        // el gesto de deslizar (`.click()`, no es del usuario) pasa siempre.
        if (e.nativeEvent.isTrusted && !empezoEnElFondo.current) return;
        pedirCierre();
      }}
    >
      <div
        ref={hoja}
        className={clases}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titulo ? idTitulo : undefined}
        aria-label={titulo ? undefined : etiqueta}
        tabIndex={-1}
        data-sin-deslizar={sinDeslizar ? "" : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {titulo && <h2 id={idTitulo}>{titulo}</h2>}
        {alEnviar ? (
          <form
            className="dialogo-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!ocupado) alEnviar();
            }}
          >
            {cuerpo}
          </form>
        ) : (
          cuerpo
        )}
      </div>
    </div>
  );
}

type Resultado = { ok: boolean; error?: string };

/**
 * Una pregunta con dos botones: la confirmación de siempre, una sola vez.
 *
 * `accion` puede ser inmediata (cerrar y listo) o una acción del servidor. Si
 * devuelve un resultado, la ventana espera mostrando `textoEnCurso`; si falló,
 * muestra el error y deja reintentar; si salió bien llama a `alListo` y queda
 * esperando a que quien la abrió la cierre (así no se reactivan los botones
 * sobre algo que ya se borró mientras la pantalla navega).
 *
 * El foco arranca en "Cancelar": un Enter de más no confirma nada.
 */
export function Confirmar({
  titulo,
  children,
  pie,
  textoConfirmar,
  textoEnCurso = "Aplicando…",
  textoCancelar = "Cancelar",
  peligro = false,
  accion,
  alListo,
  onCerrar,
}: {
  titulo: ReactNode;
  /** La explicación, debajo del título. */
  children?: ReactNode;
  /** Algo más entre la explicación y los botones (un cartel, por ejemplo). */
  pie?: ReactNode;
  textoConfirmar: string;
  textoEnCurso?: string;
  textoCancelar?: string;
  /** Botón rojo: borra o descarta algo. */
  peligro?: boolean;
  accion: () => void | Promise<Resultado>;
  alListo?: () => void;
  onCerrar: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    if (ocupado) return;
    const r = accion();
    if (!(r instanceof Promise)) return;
    setOcupado(true);
    setError(null);
    const res = await intentar(() => r);
    if (!res.ok) {
      setOcupado(false);
      return setError(res.error ?? "No se pudo completar.");
    }
    alListo?.();
  }

  return (
    <Dialogo titulo={titulo} onCerrar={onCerrar} ocupado={ocupado}>
      {children && <div className="msub">{children}</div>}
      {pie}
      {error && <MensajeDeError>{error}</MensajeDeError>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onCerrar} disabled={ocupado} autoFocus>
          {textoCancelar}
        </button>
        <button type="button" className={`btn ${peligro ? "danger" : "primary"}`} onClick={confirmar} disabled={ocupado}>
          {ocupado ? textoEnCurso : textoConfirmar}
        </button>
      </div>
    </Dialogo>
  );
}
