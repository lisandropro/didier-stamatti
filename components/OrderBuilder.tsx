"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AutosaveQueue } from "@/lib/autosave";
import { clearDraft, readDraft, writeDraft } from "@/lib/session-draft";
import { avisarDeFalloAlGuardar, mensajeDeFallo } from "@/lib/actualizacion";
import { validQuantity, MAX_QUANTITY } from "@/lib/quantity";
import { setLine, addCustomLine, setCustomQty, deleteLine, copyOrderFromEvent } from "@/app/actions/order";
import { marcarGuardado, marcarPendiente } from "@/lib/trabajo-pendiente";
import { computeShortage } from "@/lib/shortage-rule";
import { avisosDeFila, estadoDeStock, type NivelDeStock } from "@/lib/fila-de-pedido";
import { ShortagesModal } from "@/components/ShortagesModal";
import { EditEventModal } from "@/components/EditEventModal";
import { ResponsableEditor } from "@/components/ResponsableEditor";
import { RowMenu, type RowMenuItem } from "@/components/RowMenu";
import { ConfirmDeleteEvent } from "@/components/ConfirmDeleteEvent";
import { setEventStatus } from "@/app/actions/period";
import { OPCIONES_CATEGORIA as CATS } from "@/lib/categories";
import { norm, sinRueda } from "@/components/util";
import { Dialogo } from "@/components/Dialogo";
import { Campo, MensajeDeError } from "@/components/Formulario";
import { IconBack, IconCopy, IconEdit, IconInfo, IconPrint, IconSearch, IconTrash, IconWarn } from "@/components/iconos";

type ProductRow = {
  id: string;
  name: string;
  category: string;
  rubro: string | null;
  type: string;
  unit: string;
  /** null = nunca se contó: no se puede saber si alcanza. */
  stock: number | null;
  reserved: number; // pedido por los OTROS eventos del finde
  qty: number;
  note: string;
  /** Dado de baja del catálogo. Solo llega si este pedido ya lo tiene cargado. */
  deBaja?: boolean;
};
type OrderSave = { kind: "product"; row: ProductRow } | { kind: "custom"; id: string; qty: number };

type CustomLine = { id: string; name: string; unit: string | null; qty: number; note: string | null; category: string };
type SourceEvent = { id: string; lugar: string; dateLabel: string; periodLabel: string; lineCount: number };
type Data = {
  userId: string;
  /** Puede mandar el evento a la papelera (administra períodos). */
  canBorrar: boolean;
  event: {
    id: string;
    periodId: string;
    lugar: string;
    subLabel: string;
    status: string;
    responsable: string | null;
    dateLocal: string;
    guests: number;
    periodoLabel: string;
  };
  products: ProductRow[];
  customLines: CustomLine[];
  sourceEvents: SourceEvent[];
  /** Lo que el depósito ya tildó de este pedido: clave del ítem -> cantidad tildada. */
  preparados: Record<string, number>;
};


/** Id estable del input de cantidad de una fila, para devolverle el foco al destrabarla. */
const idDeCantidad = (clave: string) => "cantidad-" + clave;

/** Las acciones del pedido contestan "Tenés que iniciar sesión." cuando la
 *  sesión venció a mitad de una carga. Se reconoce por el texto porque es lo
 *  único que llega del servidor. */
const sesionVencida = (texto: string) => /iniciar sesi[oó]n/i.test(texto);

/** Color de la barra de stock según lo que dice la fila. */
const RELLENO: Record<NivelDeStock, string> = {
  neutral: "var(--muted)",
  crit: "var(--crit)",
  warn: "var(--warn)",
  ok: "var(--ok)",
};

export function OrderBuilder({ data }: { data: Data }) {
  const router = useRouter();
  const [items, setItems] = useState<ProductRow[]>(data.products);
  const [customs, setCustoms] = useState<CustomLine[]>(data.customLines);
  const [tab, setTab] = useState<string>("ENSERES");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(data.event.status);
  const [statusSaving, setStatusSaving] = useState(false);
  const draftKey = "order:" + data.userId + ":" + data.event.id;
  const [drafts] = useState(() => new Map<string, OrderSave>());
  function keepDrafts() {
    if (drafts.size) writeDraft(draftKey, [...drafts.entries()]);
    else clearDraft(draftKey);
  }
  // Lo último que ESTE teléfono sabe que quedó guardado de cada producto: lo que
  // trajo la página y, después, lo que fue guardando. Viaja con cada guardado
  // (`visto`) para que el servidor escriba solo lo que acá se tocó: cambiar la
  // nota no puede pisar la cantidad que otro teléfono cargó mientras tanto, ni
  // al revés. Es lo que la fila mostraba, no lo que hay en la base: por eso al
  // guardar se anota lo que se mandó y no lo que contestó el servidor.
  const [vistos] = useState(() => new Map(data.products.map((p) => [p.id, { qty: p.qty, note: p.note }])));
  const [queue] = useState(() => new AutosaveQueue<OrderSave>(async (value) => {
    const key = value.kind === "product" ? value.row.id : "custom:" + value.id;
    const result = value.kind === "product"
      ? await setLine({ eventId: data.event.id, productId: value.row.id, qty: value.row.qty, note: value.row.note, visto: vistos.get(value.row.id) })
      : await setCustomQty(value.id, value.qty);
    if (result.ok && value.kind === "product") vistos.set(value.row.id, { qty: value.row.qty, note: value.row.note });
    // Una respuesta vieja no puede borrar una cantidad más reciente.
    if (result.ok && drafts.get(key) === value) { drafts.delete(key); keepDrafts(); }
    return result;
  }, 700, marcarPendiente, marcarGuardado));
  const saveStatus = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const pending = saveStatus.pending;
  const savedOnce = saveStatus.saved;
  const currentItems = useRef(items);
  const [error, setError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  // Filas abiertas en el celular: tocar el nombre muestra ±10, el stock y la nota.
  const [detalle, setDetalle] = useState<Record<string, boolean>>({});
  const [showCopy, setShowCopy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showShortages, setShowShortages] = useState(false);
  const [showResp, setShowResp] = useState(false);
  const [showBorrar, setShowBorrar] = useState(false);
  // Se quiso salir del editor con algo sin guardar y no se pudo: el enlace se
  // frena para no perder lo cargado, y eso hay que decirlo. Sin este aviso se
  // tocaba "Volver" o la barra de abajo y no pasaba nada.
  const [salidaTrabada, setSalidaTrabada] = useState(false);
  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      const saved = readDraft<unknown>(draftKey);
      if (Array.isArray(saved)) {
        for (const entry of saved) {
          if (!Array.isArray(entry) || entry.length !== 2) continue;
          const [key, value] = entry;
          if (typeof key !== "string" || !value || typeof value !== "object") continue;
          if (value.kind === "product" && value.row && validQuantity(value.row.qty) && typeof value.row.note === "string" && value.row.note.length <= 1000) {
            const row = currentItems.current.find((p) => p.id === key);
            if (!row || (row.deBaja && row.qty === 0)) continue;
            const next = { ...row, qty: value.row.qty, note: value.row.note };
            currentItems.current = currentItems.current.map((p) => p.id === key ? next : p);
            const pending: OrderSave = { kind: "product", row: next };
            drafts.set(key, pending); queue.schedule(key, pending);
          } else if (value.kind === "custom" && "custom:" + value.id === key && validQuantity(value.qty, 1) && data.customLines.some((c) => c.id === value.id)) {
            const pending: OrderSave = { kind: "custom", id: value.id, qty: value.qty };
            drafts.set(key, pending); queue.schedule(key, pending);
            setCustoms((rows) => rows.map((c) => c.id === value.id ? { ...c, qty: value.qty } : c));
          }
        }
        setItems(currentItems.current);
        keepDrafts();
      }
    });
    return () => { alive = false; };
  // Se recupera una sola vez al montar este pedido.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  useEffect(() => {
    function leaving(event: BeforeUnloadEvent) {
      const saved = readDraft<unknown>(draftKey);
      const recoverable = drafts.size > 0 && JSON.stringify(saved) === JSON.stringify([...drafts.entries()]);
      if (queue.getSnapshot().pending && !recoverable) { event.preventDefault(); event.returnValue = ""; }
    }
    async function navigate(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !queue.getSnapshot().pending) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute("download")) return;
      const url = new URL(link.href);
      if (url.origin !== location.origin) return;
      event.preventDefault();
      event.stopPropagation();
      if (await queue.flush()) router.push(url.pathname + url.search + url.hash);
      else {
        // No se sale: el cartel de arriba explica por qué y qué hacer.
        setSalidaTrabada(true);
        window.scrollTo({ top: 0 });
      }
    }
    window.addEventListener("beforeunload", leaving);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", leaving);
      document.removeEventListener("click", navigate, true);
      void queue.close();
    };
  }, [queue, router, draftKey, drafts]);
  // Cuando vuelve la señal, lo que no se guardó se reintenta solo. Sin esto,
  // después de "Volvió la conexión" quedaba esperando que alguien tocara
  // "Reintentar guardado". Si no hay nada pendiente, `flush` no hace nada.
  // El aviso de red puede llegar antes de que la red conteste: si se reintenta en
  // el acto, el pedido falla y queda esperando igual (lo mismo que `SinConexion`
  // resolvió esperando 1500 ms). Si llega otro `online` antes, se reinicia la espera.
  useEffect(() => {
    let espera: ReturnType<typeof setTimeout> | undefined;
    const reintentar = () => {
      clearTimeout(espera);
      espera = setTimeout(() => { void queue.flush(); }, 1500);
    };
    window.addEventListener("online", reintentar);
    return () => {
      window.removeEventListener("online", reintentar);
      // Al salir del editor, el reintento que estaba esperando ya no va.
      clearTimeout(espera);
    };
  }, [queue]);

  function scheduleSave(key: string, pending: OrderSave) {
    drafts.set(key, pending); keepDrafts();
    queue.schedule(key, pending);
  }
  function forgetSave(key: string) { drafts.delete(key); keepDrafts(); }
  // Cambiar algo que el depósito ya preparó obliga a rehacerlo. Una fila ya
  // preparada y sin confirmar está TRABADA: tocarla solo muestra el aviso y no
  // aplica nada. "Cambiar igual" la destraba por el resto de la sesión y recién
  // ahí se edita de forma normal, con el ajuste fino sin trabas.
  //
  // No se guarda ningún cambio "pendiente de confirmar". El primer diseño lo
  // hacía (una función con el valor nuevo) y rompía al tipear: el input es
  // controlado, así que el "2" de "102" se sumaba al 10 viejo, el input volvía
  // al 10 y "Cambiar igual" aplicaba un número que nadie había visto. Si la
  // fila no cambia hasta destrabarla, no hay nada escondido que pueda divergir
  // de lo que se ve en pantalla.
  //
  // Estado y no ref: al destrabar, la fila se tiene que volver a dibujar
  // (deja de ser de solo lectura). Se actualiza siempre sin mutar.
  const [confirmados, setConfirmados] = useState<ReadonlySet<string>>(() => new Set());
  const [porConfirmar, setPorConfirmar] = useState<string | null>(null);
  // La fila a la que hay que devolverle el foco cuando termine de destrabarse.
  const aEnfocar = useRef<string | null>(null);
  function bloqueada(clave: string) {
    return data.preparados[clave] !== undefined && !confirmados.has(clave);
  }
  function conConfirmacion(clave: string, aplicar: () => void) {
    if (bloqueada(clave)) {
      setPorConfirmar(clave);
      return;
    }
    aplicar();
  }
  function confirmarCambio() {
    if (porConfirmar === null) return;
    const clave = porConfirmar;
    setConfirmados((previos) => new Set(previos).add(clave));
    aEnfocar.current = clave;
    setPorConfirmar(null);
  }
  // El foco se mueve después de dibujar, no en el clic: en ese momento el input
  // todavía es de solo lectura, y enfocarlo ahí volvería a abrir el aviso.
  useEffect(() => {
    const clave = aEnfocar.current;
    if (clave === null) return;
    aEnfocar.current = null;
    document.getElementById(idDeCantidad(clave))?.focus();
  }, [confirmados]);
  // Cambiar de pestaña o de búsqueda esconde la fila del aviso: no queda abierto
  // para cuando se vuelva.
  function elegirPestania(valor: string) {
    setTab(valor);
    setPorConfirmar(null);
  }
  function escribirBusqueda(valor: string) {
    setQuery(valor);
    setPorConfirmar(null);
  }

  function updateItem(id: string, patch: Partial<ProductRow>) {
    conConfirmacion(id, () => aplicarCambio(id, patch));
  }
  function aplicarCambio(id: string, patch: Partial<ProductRow>) {
    const previous = currentItems.current.find((p) => p.id === id);
    if (!previous) return;
    const next = { ...previous, ...patch };
    if (!validQuantity(next.qty)) return;
    currentItems.current = currentItems.current.map((p) => p.id === id ? next : p);
    setItems(currentItems.current);
    const pending: OrderSave = { kind: "product", row: next };
    scheduleSave(id, pending);
  }

  function stepQty(id: string, delta: number) {
    const previous = currentItems.current.find((p) => p.id === id);
    if (previous) updateItem(id, { qty: Math.max(0, Math.min(MAX_QUANTITY, previous.qty + delta)) });
  }

  // ---- aviso del finde en vivo (este evento + lo reservado por los otros) ----
  // Usa la MISMA función que el panel "Ver faltantes" de la vista general, para
  // que los dos no puedan decir cosas distintas del mismo pedido.
  const over = useMemo(
    () =>
      items.filter((p) =>
        computeShortage({
          productId: p.id,
          name: p.name,
          unit: p.unit,
          rubro: p.rubro,
          type: p.type,
          stock: p.stock,
          requested: p.qty,
          otherRequested: p.reserved,
        })
      ),
    [items]
  );

  const q = norm(query.trim());
  const searching = q.length > 0;
  const visible = items.filter((p) => {
    // Un producto dado de baja se muestra solo si este pedido ya lo tiene: hay
    // que poder sacarlo, pero no ofrecerlo para agregar a un pedido nuevo.
    if (p.deBaja && p.qty === 0) return false;
    if (searching) return norm(`${p.name} ${p.rubro ?? ""}`).includes(q);
    return p.category === tab;
  });

  const inOrderCount = items.filter((p) => p.qty > 0).length + customs.length;

  async function toggleStatus() {
    if (statusSaving || !(await queue.flush())) return;
    const next = status === "LISTO" ? "NO_LISTO" : "LISTO";
    setStatusSaving(true);
    setError(null);
    try {
      const result = await setEventStatus(data.event.id, next);
      if (result.ok) setStatus(next);
      else setError(result.error ?? "No se pudo cambiar el estado.");
    } catch { setError("No se pudo cambiar el estado. Revisá la conexión."); }
    finally { setStatusSaving(false); }
  }

  // Como los enlaces: primero se guarda lo pendiente, después se sale.
  async function irAlPdf() {
    if (await queue.flush()) router.push(`/evento/${data.event.id}/pdf`);
  }

  // En el celular la cabecera es una línea: volver, lugar, faltantes y este
  // menú. Medido el 19/10: con los botones a la vista ocupaba el 40 % de la
  // pantalla y entraban 2 productos.
  const menu: RowMenuItem[] = [
    { label: "Editar evento", onSelect: () => setShowEdit(true) },
    { label: "Repetir pedido", onSelect: () => setShowCopy(true), disabled: pending > 0 },
    { label: "PDF del pedido", onSelect: () => void irAlPdf() },
    {
      label: status === "LISTO" ? "Volver a borrador" : "Marcar como listo",
      onSelect: () => void toggleStatus(),
      disabled: pending > 0 || statusSaving,
    },
    { label: "Responsable del evento", onSelect: () => setShowResp(true) },
    ...(data.canBorrar ? [{ label: "Borrar evento", onSelect: () => setShowBorrar(true), disabled: pending > 0, peligro: true }] : []),
  ];

  return (
    <>
      <div className="topbar topbar-pedido">
        <Link className="topbar-volver solo-celular" href="/" aria-label="Volver">{IconBack}</Link>
        <div className="topbar-titulo">
          <h1>{data.event.lugar}</h1>
          <div className="sub">
            {status === "LISTO" && <span className="sub-listo solo-celular">Listo</span>}
            <span className="sub-datos">
              {data.event.subLabel} · {inOrderCount} producto{inOrderCount === 1 ? "" : "s"} en el pedido
            </span>
            <span role="status" aria-live="polite" className={`save-ind${!saveStatus.error && pending === 0 && !savedOnce ? " inicial" : ""}`}>
              {saveStatus.error ? "Sin guardar" : pending > 0 ? "Guardando…" : savedOnce ? "Guardado ✓" : "Se guarda solo mientras cargás"}
            </span>
          </div>
        </div>
        <div className="spacer" />
        <Link className="btn ghost solo-ancho" href="/">Volver</Link>
        {/* Único lugar donde se informan los faltantes: no hay banner aparte. */}
        {over.length > 0 && (
          <button
            type="button"
            className="btn btn-falta-top"
            onClick={() => setShowShortages(true)}
            aria-label={`Ver faltantes (${over.length})`}
          >
            {IconWarn} <span className="solo-ancho">Ver faltantes</span> <span className="count-pill">{over.length}</span>
          </button>
        )}
        <div className="topbar-acciones solo-ancho">
          <button className="btn ghost" onClick={() => setShowEdit(true)}>{IconEdit} Editar evento</button>
          <button className="btn ghost" disabled={pending > 0} onClick={() => setShowCopy(true)}>{IconCopy} Repetir pedido</button>
          <Link className="btn ghost" href={`/evento/${data.event.id}/pdf`}>
            {IconPrint}
            PDF del pedido
          </Link>
          <button className={`btn${status === "LISTO" ? "" : " primary"}`} disabled={pending > 0 || statusSaving} onClick={toggleStatus}>
            {status === "LISTO" ? "✓ Listo — volver a borrador" : "Marcar como listo"}
          </button>
          {data.canBorrar && (
            <button className="btn btn-del" disabled={pending > 0} onClick={() => setShowBorrar(true)} title="Mandar el evento a la papelera">
              {IconTrash} Borrar
            </button>
          )}
        </div>
        <div className="solo-celular">
          <RowMenu items={menu} label="Más acciones del pedido" grande />
        </div>
      </div>

      <div className="content">
        {(error || saveStatus.error) && (
          <div role="alert" className="banner crit">{IconWarn}<div><b>{error || saveStatus.error}</b>
            {saveStatus.error && salidaTrabada && (
              <p>No salimos de esta pantalla para no perder lo que cargaste: primero tiene que guardarse.</p>
            )}
            {saveStatus.error && sesionVencida(saveStatus.error) ? (
              <>
                {/* Reintentar no sirve sin sesión: hay que volver a entrar. Lo
                    cargado queda guardado en este teléfono (el borrador) y se
                    vuelve a mandar al abrir otra vez el pedido. Carga completa y
                    no un enlace de la app: los enlaces están frenados mientras
                    haya algo sin guardar. */}
                <p>Lo que cargaste queda guardado acá y se manda solo cuando vuelvas a abrir este pedido.</p>
                <button
                  type="button"
                  className="btn primary"
                  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- carga completa a propósito
                  onClick={() => window.location.assign("/login")}
                >
                  Iniciar sesión
                </button>
              </>
            ) : saveStatus.error ? (
              <button type="button" className="btn ghost" onClick={() => { void queue.flush().then((ok) => { if (ok) setSalidaTrabada(false); }); }}>Reintentar guardado</button>
            ) : null}
          </div></div>
        )}

        <div className="ro-resp solo-ancho">
          <span className="ro-resp-label">Responsable del evento</span>
          <ResponsableEditor eventId={data.event.id} responsable={data.event.responsable} canEdit />
        </div>


        <div className="searchbar">
          <label className="search">
            {IconSearch}
            <input
              aria-label="Buscar en todo el catálogo"
              enterKeyHint="search"
              placeholder="Buscar en todo el catálogo…"
              value={query}
              onChange={(e) => escribirBusqueda(e.target.value)}
            />
          </label>
          {!searching && (
            <div className="filtros-scroll">
              {CATS.map((c) => (
                <button key={c.v} type="button" className={`tab${tab === c.v ? " active" : ""}`} aria-pressed={tab === c.v} onClick={() => elegirPestania(c.v)}>
                  {c.l}
                </button>
              ))}
              <button type="button" className={`tab${tab === "EXTRAS" ? " active" : ""}`} aria-pressed={tab === "EXTRAS"} onClick={() => elegirPestania("EXTRAS")}>
                Extras{customs.length > 0 ? ` (${customs.length})` : ""}
              </button>
            </div>
          )}
        </div>

        {tab === "EXTRAS" && !searching ? (
          <ExtrasPanel
            eventId={data.event.id}
            customs={customs}
            setCustoms={setCustoms}
            onRefresh={() => router.refresh()}
            queue={queue}
            scheduleSave={scheduleSave}
            forgetSave={forgetSave}
            onError={setError}
            preparados={data.preparados}
            bloqueada={bloqueada}
            conConfirmacion={conConfirmacion}
            porConfirmar={porConfirmar}
            onPedirConfirmacion={setPorConfirmar}
            onConfirmar={confirmarCambio}
            onCancelar={() => setPorConfirmar(null)}
          />
        ) : (
          <div className="olist">
            {visible.length === 0 && (
              <div className="emptyrow">No hay productos que coincidan con la búsqueda.</div>
            )}
            {visible.map((p) => {
              const reutil = p.type === "REUTILIZABLE";
              const total = p.qty + p.reserved;
              const contado = reutil && p.stock !== null;
              const hay = p.stock ?? 0;
              const pct = contado && hay > 0 ? Math.min(100, Math.round((total / hay) * 100)) : total > 0 ? 100 : 0;
              const st = estadoDeStock(p);
              const avisos = avisosDeFila(p);
              const abierta = detalle[p.id] === true;
              const rubro = (
                <>
                  {searching ? `${CATS.find((c) => c.v === p.category)?.l ?? p.category} · ` : ""}
                  {p.rubro}
                  {p.unit !== "Unidad" ? ` · por ${p.unit.toLowerCase()}` : ""}
                  {p.deBaja ? " · ya no está en el catálogo, poné 0 para sacarlo" : ""}
                </>
              );
              const trabada = bloqueada(p.id);
              return (
                <div key={p.id} className={`orow${p.qty > 0 ? " has-qty" : ""}${abierta ? " abierta" : ""}`}>
                  <div className="ocol-name">
                    {/* En el celular, tocar el nombre abre el detalle: ±10, el stock y
                        la nota. En la pantalla ancha todo eso ya está a la vista. */}
                    <button
                      type="button"
                      className="pname pname-btn"
                      aria-expanded={abierta}
                      onClick={() => setDetalle((s) => ({ ...s, [p.id]: !s[p.id] }))}
                    >
                      {p.name}
                      {p.deBaja && <span className="chip crit chip-baja">Dado de baja</span>}
                      {data.preparados[p.id] !== undefined && <span className="chip ok chip-prep">Preparado</span>}
                    </button>
                    <div className="rubro solo-ancho">{rubro}</div>
                    {/* La segunda línea del celular: solo si hay algo que decir. */}
                    {avisos.length > 0 && (
                      <div className="orow-resumen solo-celular">
                        {avisos.map((a) => (
                          <span key={a.cls + a.txt} className={`resumen-${a.cls}`}>{a.txt}</span>
                        ))}
                      </div>
                    )}
                    <button
                      className={`note-toggle solo-ancho${p.note ? " has-note" : ""}`}
                      onClick={() => {
                        // Trabada, la nota tampoco se abre: se pregunta primero.
                        if (trabada) setPorConfirmar(p.id);
                        else setNoteOpen((s) => ({ ...s, [p.id]: !s[p.id] }));
                      }}
                    >
                      {p.note ? `✎ ${p.note}` : "+ nota"}
                    </button>
                    {noteOpen[p.id] && (
                      <input
                        className="note-input solo-ancho"
                        type="text"
                        placeholder="Aclaración… (ej: doradas, para postre)"
                        value={p.note}
                        autoFocus
                        // Si el depósito tilda la fila con la nota abierta (llega con una
                        // recarga), el campo se traba en vez de tragarse lo que se tipea.
                        readOnly={trabada}
                        onFocus={trabada ? () => setPorConfirmar(p.id) : undefined}
                        onPointerDown={trabada ? () => setPorConfirmar(p.id) : undefined}
                        onChange={(e) => updateItem(p.id, { note: e.target.value })}
                        onBlur={() => setNoteOpen((s) => ({ ...s, [p.id]: false }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setNoteOpen((s) => ({ ...s, [p.id]: false }));
                        }}
                      />
                    )}
                  </div>

                  <div className="ocol-stock solo-ancho">
                    {reutil ? (
                      <>
                        <div className="bar"><div className="fill" style={{ width: `${pct}%`, background: st ? RELLENO[st.cls] : "var(--muted)" }} /></div>
                        <div className="line">
                          Depósito: <b>{p.stock ?? "sin contar"}</b> · Otros eventos: <b>{p.reserved}</b>
                          {st && <span className={`chip ${st.cls}`}>{st.txt}</span>}
                        </div>
                      </>
                    ) : (
                      <span className="chip neutral">Se compra por evento</span>
                    )}
                  </div>

                  <div className="ocol-qty">
                    <button className="qbtn wide solo-ancho" onClick={() => stepQty(p.id, -10)} aria-label="Restar diez">−10</button>
                    <button className="qbtn" onClick={() => stepQty(p.id, -1)} aria-label="Restar uno">−</button>
                    <input
                      className="qinput"
                      type="number" onWheel={sinRueda}
                      inputMode="numeric"
                      min={0}
                      id={idDeCantidad(p.id)}
                      value={p.qty === 0 ? "" : p.qty}
                      placeholder="0"
                      // Trabado no se puede tipear: el aviso se abre al tocarlo y no se
                      // captura ninguna tecla.
                      readOnly={trabada}
                      title={trabada ? "Ya está preparado: tocá para cambiarlo" : undefined}
                      onFocus={trabada ? () => setPorConfirmar(p.id) : undefined}
                      onPointerDown={trabada ? () => setPorConfirmar(p.id) : undefined}
                      onChange={(e) => {
                        const n = e.target.value.trim() === "" ? 0 : Math.max(0, Math.round(Number(e.target.value)));
                        updateItem(p.id, { qty: Number.isFinite(n) ? n : 0 });
                      }}
                      aria-label={`Cantidad de ${p.name}`}
                    />
                    <button className="qbtn" onClick={() => stepQty(p.id, 1)} aria-label="Sumar uno">+</button>
                    <button className="qbtn wide solo-ancho" onClick={() => stepQty(p.id, 10)} aria-label="Sumar diez">+10</button>
                  </div>

                  {abierta && (
                    <div className="orow-detalle solo-celular">
                      <div className="rubro">{rubro}</div>
                      <div>
                        {reutil ? (
                          <>Depósito: <b>{p.stock ?? "sin contar"}</b> · Otros eventos: <b>{p.reserved}</b></>
                        ) : (
                          "Se compra por evento"
                        )}
                      </div>
                      <div className="detalle-pasos">
                        <button className="qbtn wide" onClick={() => stepQty(p.id, -10)} aria-label="Restar diez">−10</button>
                        <button className="qbtn wide" onClick={() => stepQty(p.id, 10)} aria-label="Sumar diez">+10</button>
                      </div>
                      <input
                        className="detalle-nota"
                        type="text"
                        placeholder="Nota… (ej: doradas, para postre)"
                        value={p.note}
                        // La misma traba que la cantidad: preparado, se pregunta antes.
                        readOnly={trabada}
                        onFocus={trabada ? () => setPorConfirmar(p.id) : undefined}
                        onPointerDown={trabada ? () => setPorConfirmar(p.id) : undefined}
                        onChange={(e) => updateItem(p.id, { note: e.target.value })}
                        aria-label={`Nota de ${p.name}`}
                      />
                    </div>
                  )}
                  {porConfirmar === p.id && (
                    <div className="prep-aviso-fila" role="alert">
                      <span>
                        Ya está preparado ({data.preparados[p.id]}). Si lo cambiás, el depósito tiene que rehacerlo.
                      </span>
                      <button className="btn primary" onClick={confirmarCambio}>Cambiar igual</button>
                      <button className="btn ghost" onClick={() => setPorConfirmar(null)}>Cancelar</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="hint">
          {IconInfo}
          Lo vacío no va en el pedido. “Otros eventos” es lo que ya pidieron los demás eventos de este período del mismo depósito.
        </div>
      </div>

      {showShortages && (
        <ShortagesModal
          eventId={data.event.id}
          lugar={data.event.lugar}
          onClose={() => setShowShortages(false)}
        />
      )}
      {showCopy && (
        <CopyOrderModal
          targetEventId={data.event.id}
          hasLines={inOrderCount > 0}
          sourceEvents={data.sourceEvents}
          preparadosCount={Object.keys(data.preparados).length}
          onClose={() => setShowCopy(false)}
        />
      )}
      {showEdit && (
        <EditEventModal
          evento={{
            id: data.event.id,
            lugar: data.event.lugar,
            dateLocal: data.event.dateLocal,
            guests: data.event.guests,
            periodoLabel: data.event.periodoLabel,
          }}
          onClose={() => setShowEdit(false)}
          onSaved={() => setShowEdit(false)}
        />
      )}
      {showResp && (
        <Dialogo titulo="Responsable del evento" onCerrar={() => setShowResp(false)} sinDeslizar>
          <ResponsableEditor eventId={data.event.id} responsable={data.event.responsable} canEdit />
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setShowResp(false)}>Cerrar</button>
          </div>
        </Dialogo>
      )}
      {showBorrar && (
        <ConfirmDeleteEvent
          evento={{ id: data.event.id, lugar: data.event.lugar, lineCount: inOrderCount }}
          onClose={() => setShowBorrar(false)}
          onDeleted={() => router.push(`/?w=${data.event.periodId}`)}
        />
      )}
    </>
  );
}

function CopyOrderModal({
  targetEventId,
  hasLines,
  sourceEvents,
  preparadosCount,
  onClose,
}: {
  targetEventId: string;
  hasLines: boolean;
  sourceEvents: SourceEvent[];
  preparadosCount: number;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<SourceEvent | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
    const res = await copyOrderFromEvent(targetEventId, selected.id);
    if (res.ok) {
      // Recarga completa: el armador siembra su estado desde el servidor al montar,
      // así el pedido copiado se ve reflejado de forma confiable.
      window.location.reload();
    } else {
      setSaving(false);
      setError(res.error ?? "No se pudo copiar.");
    }
    } catch (error) { setError(mensajeDeFallo(error)); avisarDeFalloAlGuardar(error); }
    finally { setSaving(false); }
  }

  const q = norm(query.trim());
  const list = q
    ? sourceEvents.filter((e) => norm(`${e.lugar} ${e.periodLabel}`).includes(q))
    : sourceEvents;

  return (
    // Un solo `Dialogo` para los dos pasos. Mientras copia no se cierra: antes,
    // tocar afuera escondía la ventana con la copia en curso.
    <Dialogo
      titulo={selected ? "¿Copiar este pedido?" : "Repetir pedido"}
      onCerrar={onClose}
      ocupado={saving}
    >
      {selected ? (
        <>
          <div className="msub">
            Vas a traer el pedido de <b>{selected.lugar}</b> ({selected.dateLabel}, {selected.lineCount} producto
            {selected.lineCount === 1 ? "" : "s"}) a este evento.
            {hasLines && <> <b>Reemplaza</b> lo que ya cargaste en este evento.</>}
            {preparadosCount > 0 && (
              <> <b>{preparadosCount} {preparadosCount === 1 ? "ítem ya está preparado y va a cambiar" : "ítems ya están preparados y van a cambiar"}:</b> el depósito va a tener que rehacerlos.</>
            )}
          </div>
          {error && <MensajeDeError>{error}</MensajeDeError>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setSelected(null)} disabled={saving} autoFocus>Volver</button>
            <button type="button" className="btn primary" onClick={confirm} disabled={saving}>
              {saving ? "Copiando…" : "Copiar pedido"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="msub">Elegí un evento anterior y traé su pedido a este, para no cargarlo de cero.</div>
          {sourceEvents.length === 0 ? (
            <div className="emptyrow">Todavía no hay otros eventos con pedido para copiar.</div>
          ) : (
            <>
              <label className="search" style={{ marginBottom: "var(--sp-3)" }}>
                {IconSearch}
                <input aria-label="Buscar un evento por lugar o período" enterKeyHint="search" placeholder="Buscar por lugar o período…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <div className="copy-list">
                {list.map((e) => (
                  <button key={e.id} type="button" className="copy-row" onClick={() => setSelected(e)}>
                    <div>
                      <div className="copy-lugar">{e.lugar}</div>
                      <div className="copy-meta">{e.periodLabel} · {e.dateLabel}</div>
                    </div>
                    <span className="chip neutral">{e.lineCount} prod.</span>
                  </button>
                ))}
                {list.length === 0 && <div className="emptyrow">No hay eventos que coincidan.</div>}
              </div>
            </>
          )}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>Cerrar</button>
          </div>
        </>
      )}
    </Dialogo>
  );
}

function ExtrasPanel({
  eventId,
  customs,
  setCustoms,
  onRefresh,
  queue,
  scheduleSave,
  forgetSave,
  onError,
  preparados,
  bloqueada,
  conConfirmacion,
  porConfirmar,
  onPedirConfirmacion,
  onConfirmar,
  onCancelar,
}: {
  eventId: string;
  customs: CustomLine[];
  setCustoms: React.Dispatch<React.SetStateAction<CustomLine[]>>;
  onRefresh: () => void;
  queue: AutosaveQueue<OrderSave>;
  scheduleSave: (key: string, value: OrderSave) => void;
  forgetSave: (key: string) => void;
  onError: (error: string | null) => void;
  preparados: Record<string, number>;
  /** Preparada y sin confirmar: la fila no se edita, solo muestra el aviso. */
  bloqueada: (clave: string) => boolean;
  conConfirmacion: (clave: string, aplicar: () => void) => void;
  porConfirmar: string | null;
  onPedirConfirmacion: (clave: string) => void;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [qty, setQty] = useState("1");
  const [saving, setSaving] = useState(false);


  async function add() {
    if (!name.trim() || !category || saving) return;
    if (!validQuantity(Number(qty), 1)) { onError("Ingresá una cantidad entera mayor que cero."); return; }
    setSaving(true);
    onError(null);
    marcarPendiente();
    try {
    const res = await addCustomLine({ eventId, name, category, unit, qty: Number(qty) || 1 });
    if (res.ok && res.lineId) {
      setCustoms((prev) => [
        ...prev,
        {
          id: res.lineId as string,
          name: name.trim(),
          category,
          unit: unit.trim() || null,
          qty: Math.max(1, Math.round(Number(qty) || 1)),
          note: null,
        },
      ]);
      setName("");
      setCategory("");
      setUnit("");
      setQty("1");
      onRefresh();
    } else { onError(res.error ?? "No se pudo agregar el ítem."); }
    } catch (error) { onError(mensajeDeFallo(error)); avisarDeFalloAlGuardar(error); }
    finally { setSaving(false); marcarGuardado(); }
  }

  /** Enter en cualquiera de los campos agrega el ítem, como el botón. */
  function conEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") void add();
  }

  function changeQty(id: string, next: number) {
    const q = Math.max(1, next);
    if (saving || !validQuantity(q, 1)) return;
    setCustoms((prev) => prev.map((c) => (c.id === id ? { ...c, qty: q } : c)));
    if (validQuantity(q, 1)) scheduleSave("custom:" + id, { kind: "custom", id, qty: q });
  }

  async function remove(id: string) {
    if (saving) return;
    setSaving(true);
    onError(null);
    marcarPendiente();
    try {
      await queue.cancel("custom:" + id);
      const result = await deleteLine(id);
      if (!result.ok) { onError(result.error ?? "No se pudo quitar el ítem."); return; }
      forgetSave("custom:" + id);
      setCustoms((prev) => prev.filter((c) => c.id !== id));
      onRefresh();
    } catch (error) { onError(mensajeDeFallo(error)); avisarDeFalloAlGuardar(error); }
    finally { setSaving(false); marcarGuardado(); }
  }

  // Las dos entradas a cambiar un suelto pasan por la misma pregunta que los
  // productos del catálogo.
  function pedirCambio(id: string, next: number) {
    conConfirmacion(`custom:${id}`, () => changeQty(id, next));
  }
  function pedirQuitar(id: string) {
    conConfirmacion(`custom:${id}`, () => void remove(id));
  }

  return (
    <>
      <div className="extras-form">
        <Campo label="Ítem fuera de catálogo" style={{ flex: 2, marginBottom: 0 }}>
          <input type="text" placeholder="Ej: Vajilla alquilada, hielo seco…" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={conEnter} />
        </Campo>
        <Campo label="Sector" style={{ flex: 1.1, marginBottom: 0 }}>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="" disabled>Elegir…</option>
            {CATS.map((c) => (
              <option key={c.v} value={c.v}>{c.l}</option>
            ))}
          </select>
        </Campo>
        <Campo label="Unidad (opcional)" style={{ flex: 1, marginBottom: 0 }}>
          <input type="text" placeholder="Cajas, bolsas…" value={unit} onChange={(e) => setUnit(e.target.value)} onKeyDown={conEnter} />
        </Campo>
        <Campo label="Cantidad" style={{ width: 90, marginBottom: 0 }}>
          <input type="number" onWheel={sinRueda} inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={conEnter} />
        </Campo>
        <button type="button" className="btn primary" onClick={add} disabled={saving || !name.trim() || !category}>
          {saving ? "Agregando…" : "Agregar"}
        </button>
      </div>

      <div className="olist" style={{ marginTop: 16 }}>
        {customs.length === 0 && (
          <div className="emptyrow">
            Sin ítems extra. Estos ítems no llevan control de stock y salen en el pedido del evento.
          </div>
        )}
        {customs.map((c) => {
          const clave = `custom:${c.id}`;
          const trabada = bloqueada(clave);
          return (
            <div key={c.id} className="orow has-qty">
              <div className="ocol-name">
                <div className="pname">{c.name}</div>
                <div className="rubro">
                  {CATS.find((cat) => cat.v === c.category)?.l ?? c.category} · Fuera de catálogo
                  {c.unit ? ` · por ${c.unit.toLowerCase()}` : ""}
                </div>
              </div>
              <div className="ocol-stock solo-ancho">
                <span className="chip neutral">Sin control de stock</span>
              </div>
              <div className="ocol-qty">
                <button className="qbtn" onClick={() => pedirCambio(c.id, c.qty - 1)} aria-label="Restar uno">−</button>
                <input
                  className="qinput"
                  type="number" onWheel={sinRueda}
                  inputMode="numeric"
                  min={1}
                  id={idDeCantidad(clave)}
                  value={c.qty}
                  // Igual que en el catálogo: trabado no captura teclas, abre el aviso.
                  readOnly={trabada}
                  title={trabada ? "Ya está preparado: tocá para cambiarlo" : undefined}
                  onFocus={trabada ? () => onPedirConfirmacion(clave) : undefined}
                  onPointerDown={trabada ? () => onPedirConfirmacion(clave) : undefined}
                  onChange={(e) => pedirCambio(c.id, Math.round(Number(e.target.value)) || 1)}
                  aria-label={`Cantidad de ${c.name}`}
                />
                <button className="qbtn" onClick={() => pedirCambio(c.id, c.qty + 1)} aria-label="Sumar uno">+</button>
                <button className="qbtn danger" onClick={() => pedirQuitar(c.id)} aria-label={`Borrar ${c.name}`}>{IconTrash}</button>
              </div>
              {porConfirmar === clave && (
                <div className="prep-aviso-fila" role="alert">
                  <span>
                    Ya está preparado ({preparados[clave]}). Si lo cambiás, el depósito tiene que rehacerlo.
                  </span>
                  <button className="btn primary" onClick={onConfirmar}>Cambiar igual</button>
                  <button className="btn ghost" onClick={onCancelar}>Cancelar</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
