import Link from "next/link";

/**
 * Lo que se ve cuando algo no existe — o cuando existe pero no es tuyo.
 *
 * Sin esto salía la pantalla de error de Next: sin estilo y en inglés. Dice lo
 * mismo para las dos situaciones a propósito: si a quien busca la sugerencia de
 * otro se le dijera "no tenés permiso", ya sabría que existe.
 */
export default function NotFound() {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <span className="logo-mark" role="img" aria-label="Didier Stamatti Catering" />
        </div>
        <h1>No encontramos eso</h1>
        <p className="login-sub">
          Puede que se haya borrado, que el enlace esté mal escrito o que no sea tuyo.
        </p>
        <Link className="btn primary" href="/" style={{ width: "100%", justifyContent: "center" }}>
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
