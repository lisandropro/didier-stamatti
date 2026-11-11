import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Las cabeceras de seguridad y el control de salud son configuración: nadie
// las mira hasta que faltan. Estas pruebas avisan si alguien las saca.

type Cabecera = { key: string; value: string };

async function cabeceras(entorno: string): Promise<Map<string, string>> {
  const original = process.env.NODE_ENV;
  // @ts-expect-error NODE_ENV es de solo lectura en los tipos de Next.
  process.env.NODE_ENV = entorno;
  try {
    const { default: config } = await import("../next.config");
    const reglas = await config("phase-development-server").headers!();
    const todas = reglas.find((r) => r.source === "/:path*");
    assert.ok(todas, "tiene que haber una regla para todas las rutas");
    return new Map((todas.headers as Cabecera[]).map((h) => [h.key, h.value]));
  } finally {
    // @ts-expect-error ídem.
    process.env.NODE_ENV = original;
  }
}

test("en producción van la política de contenido y el https obligatorio", async () => {
  const h = await cabeceras("production");
  const csp = h.get("Content-Security-Policy") ?? "";
  for (const regla of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'", "connect-src 'self'"]) {
    assert.ok(csp.includes(regla), `falta ${regla}`);
  }
  // Nada de afuera: ni un dominio, ni comodines.
  assert.doesNotMatch(csp, /https?:\/\/|\*/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.match(h.get("Strict-Transport-Security") ?? "", /max-age=31536000/);
});

test("en desarrollo no, porque Next recarga con eval y no hay https", async () => {
  const h = await cabeceras("development");
  assert.equal(h.has("Content-Security-Policy"), false);
  assert.equal(h.has("Strict-Transport-Security"), false);
});

test("las cabeceras de siempre van en los dos", async () => {
  for (const entorno of ["production", "development"]) {
    const h = await cabeceras(entorno);
    assert.equal(h.get("X-Content-Type-Options"), "nosniff");
    assert.equal(h.get("X-Frame-Options"), "SAMEORIGIN");
    assert.match(h.get("Permissions-Policy") ?? "", /camera=\(\).*geolocation=\(\)/);
  }
});

test("Railway consulta la ruta de salud, y la ruta existe", () => {
  const raiz = path.join(import.meta.dirname, "..");
  const railway = JSON.parse(fs.readFileSync(path.join(raiz, "railway.json"), "utf8"));
  assert.equal(railway.deploy.healthcheckPath, "/api/salud");
  const ruta = fs.readFileSync(path.join(raiz, "app/api/salud/route.ts"), "utf8");
  assert.match(ruta, /export async function GET/);
  // Es pública: no puede decir nada del negocio ni pedir sesión.
  assert.doesNotMatch(ruta, /getSessionUser|findMany|findFirst/);
});
