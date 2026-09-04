import pkg from "../package.json" with { type: "json" };

/**
 * Qué versión de la app está corriendo.
 *
 * Sirve para una sola cosa: cuando alguien reporta un problema, saber contra
 * qué código lo vio. El número de `package.json` casi nunca se toca, así que lo
 * que de verdad identifica la versión es el commit — Railway lo pone en el
 * entorno al construir. En local no existe y queda solo el número.
 */
export function appVersion(): string {
  // APP_BUILD_ID lo fija next.config al compilar, así que cambia con cada
  // despliegue y existe también en tiempo de ejecución — la variable de git de
  // Railway no, y por eso no se usa.
  const build = process.env.APP_BUILD_ID;
  return build ? `${pkg.version}+${build}` : `${pkg.version} (sin build)`;
}
