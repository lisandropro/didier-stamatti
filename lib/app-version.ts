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
  const commit = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7);
  return commit ? `${pkg.version}+${commit}` : `${pkg.version} (local)`;
}
