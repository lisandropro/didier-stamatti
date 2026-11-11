# Didier Stamatti Catering — Pedidos y stock

La app con la que el equipo arma los pedidos de vajilla, mantelería, bebida y
mobiliario de cada evento, controla que el stock alcance, prepara lo que sale
del depósito y revisa lo que vuelve.

Es una app interna: la usan unas pocas personas, casi todas desde el teléfono,
instalada como app (PWA).

## Qué hace

| Pantalla | Para qué | Quién |
|---|---|---|
| **Período** | Los eventos de un período (un fin de semana, una semana) y si el stock alcanza entre todos | Administradora, armadores, logística |
| **Pedido de un evento** | Cargar cantidades por sector, notas, ítems fuera de catálogo; PDF y carteles por sector | Administradora, armadores |
| **Inventario** | Catálogo y stock contado; ajustes con su motivo | Administradora (los demás miran) |
| **Historial** | Períodos pasados y movimientos de stock | Administradora, armadores, logística |
| **Preparar** | Lista para juntar lo de cada evento y tildar lo preparado; qué cambió después | Depósito, logística, administradora |
| **Levante** | Después del evento: qué volvió y qué falta; descontar roturas y pérdidas | Depósito, logística; descuenta la administradora |
| **Avisos** | Cambios en los pedidos, faltantes, pedidos sin armar, resumen de la mañana | Todos |
| **Sugerencias** | Canal del equipo hacia quien mantiene la app | Todos |

Los permisos están en un solo archivo, `lib/permissions.ts`. Esconder un botón
no es un permiso: toda acción que escribe los comprueba en el servidor.

Las finanzas (facturación, pagos, margen) **no** están acá: van en un sistema de
gestión aparte.

## Con qué está hecha

- **Next.js 16** (App Router, server actions) y **React 19**
- **Prisma 7** sobre **SQLite** (`better-sqlite3`), en un volumen persistente
- **Web Push** para los avisos, con service worker propio (`public/sw.js`)
- **@react-pdf/renderer** para los PDF del pedido
- Estilos propios en `app/globals.css` (tokens de color, espaciado y tipografía; tema claro y oscuro)
- Desplegada en **Railway**; respaldo diario de la base a un bucket S3

> Next 16 cambió varias cosas respecto de versiones anteriores. Antes de tocar
> caché, cabeceras o server actions, leer la guía en `node_modules/next/dist/docs/`.

## Correrla en local

Hace falta Node 20.19 o más nuevo.

```bash
npm ci
cp .env.example .env        # y completar AUTH_SECRET y SEED_ADMIN_PASSWORD
npx prisma migrate deploy   # crea dev.db con todas las tablas
npm run db:seed             # carga el catálogo y crea el usuario administrador
npm run dev
```

Queda en <http://localhost:3000>. Se entra con el email del administrador del
seed y la contraseña de `SEED_ADMIN_PASSWORD`.

Dos cosas que ya costaron tiempo:

- **Probar desde un teléfono por la red local** (`http://192.168.x.x:3000`) no
  es un "contexto seguro": no hay service worker ni avisos. Para eso hay que
  desplegar.
- **Si los estilos no cambian** después de editar la hoja, borrar `.next` y
  volver a levantar: la caché de Turbopack puede servir una hoja vieja.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Compilar y correr como en producción |
| `npm run check` | Tipos, lint y pruebas: lo mismo que corre la integración continua |
| `npm run typecheck` | Solo los tipos |
| `npm run lint` | Solo ESLint |
| `npm test` | Todas las pruebas (tarda varios minutos: muchas crean su propia base) |
| `node --import tsx --test tests/<archivo>.test.ts` | Una sola prueba |
| `npm run db:seed` | Catálogo y administrador inicial. **Borra pedidos y stock**: no corre contra producción sin `--force` |
| `npm run set-password -- <email> "<clave>"` | Cambiarle la contraseña a alguien desde la consola |

## Variables de entorno

Están todas en `.env.example`, con su explicación. Las indispensables:

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Dónde está la base. En producción, el archivo del volumen |
| `AUTH_SECRET` | Firma de las sesiones. Mínimo 32 bytes |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Avisos push. Vacías, la app anda sin avisos al teléfono |
| `BACKUP_S3_*` | Respaldo diario. Sin `BACKUP_S3_BUCKET` no se respalda |

## Cómo está organizado el código

```
app/
  (app)/          pantallas con sesión (una carpeta por ruta)
  actions/        server actions: todo lo que escribe pasa por acá
  api/            rutas: PDF, avisos push, salud, respaldo a pedido
  login/          ingreso
  globals.css     toda la hoja de estilos
components/       componentes de pantalla (Dialogo, Formulario e iconos son la base común)
lib/              la lógica, sin pantallas
  x.ts            reglas puras, sin base (se prueban solas)
  x-db.ts         lo mismo contra la base; aceptan el cliente o una transacción
prisma/           esquema, migraciones, catálogo inicial
tests/            pruebas (node:test)
instrumentation.ts  tareas que corren solas: avisos, faltantes, papelera, respaldo
```

Reglas de la casa, que el código ya sigue y conviene no romper:

- **Fechas:** un día es un texto `AAAA-MM-DD`; solo los eventos tienen hora.
  Todo pasa por `lib/dates.ts`, que calcula en hora argentina. Nunca
  `getDate()`/`getHours()` sueltos: el servidor corre en UTC.
- **Escribir con condición:** `updateMany({ where: { id, <estado esperado> } })`
  y decidir por `count`. Así dos teléfonos a la vez no se pisan ni avisan doble.
- **"Lo visto":** la pantalla manda lo que mostraba y el servidor contesta si ya
  cambió, en vez de pisarlo.
- **Las acciones devuelven `{ ok, error? }`**, nunca una excepción cruda, y
  comprueban en runtime lo que reciben (`lib/entrada.ts`).
- **Antes de reemplazar pedidos se guarda una versión recuperable**
  (`lib/snapshot.ts`). Borrar manda a la papelera, que se vacía sola.
- **Los avisos nunca hacen fallar la acción** que los dispara: primero se
  guarda, después se avisa.
- **La base tiene una sola conexión.** `lib/db.ts` ordena transacciones y
  escrituras sueltas para que no se mezclen (`lib/turno-db.ts`).

## Despliegue

Railway publica solo lo que llega a `main`: compila, corre
`prisma migrate deploy` y arranca. Antes de recibir a nadie pregunta
`/api/salud`; si no contesta 200, la versión nueva no se publica.

Las migraciones solo agregan o reconstruyen tablas conservando los datos. Antes
de desplegar una, probarla sobre una copia de la base de producción.

Al arrancar, la app hace un respaldo y una revisión de datos; después, una vez
por día. Lo que encuentra se le avisa a la administradora.

## Documentos de diseño

En `docs/superpowers/` están los diseños y planes de cada pieza grande
(depósito y avisos, levante, papelera, eventos pasados), escritos antes de
construirlas.
