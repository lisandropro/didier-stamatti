# Volver atrás "stock sin recuento"

Qué hacer si la migración `20260819150000_stock_sin_recuento` resulta un problema
en producción. Escrito antes de desplegarla, con la cabeza fría.

**Ya está probado.** Sobre una copia de producción del 19/08: se aplicó la
migración, se corrió esta reversión, y los 227 productos quedaron **idénticos**
al original — mismo número, mismo todo. El esquema volvió a `stock NOT NULL` y
ninguna otra tabla se movió.

## La trampa que hay que evitar

**No borres la carpeta de la migración de ida.** Prisma guarda en la base qué
migraciones aplicó. Si encuentra en la base una que no existe en el repo,
`prisma migrate deploy` falla — y como el arranque del contenedor es
`prisma migrate deploy && next start`, la app no levanta.

Por eso la vuelta atrás es **hacia adelante**: se agrega una migración nueva que
deshace, en vez de borrar la vieja.

## Los pasos

### 1. Probarla sobre una copia (siempre)

```bash
railway volume files -v didier-catering-volume download /dev.db copia.db
npm run revertir:sin-recuento -- copia.db
```

El guion se niega a tocar nada si la base no está sana, si ya está en el esquema
viejo, o si al terminar cambió algún número. En un mal momento nadie está para
leer con calma lo que salió raro: mejor que no haga nada.

### 2. Dejar la migración de vuelta en su lugar

```bash
mkdir -p prisma/migrations/20260819160000_revertir_stock_sin_recuento
cp scripts/reversion/revertir-stock-sin-recuento.sql \
   prisma/migrations/20260819160000_revertir_stock_sin_recuento/migration.sql
```

### 3. Revertir el código, conservando las DOS carpetas de migración

```bash
git revert --no-commit 974fd1a
git checkout HEAD -- prisma/migrations/20260819150000_stock_sin_recuento
git commit
```

El `git checkout` del medio es el paso que la gente olvida: sin él, el revert se
lleva puesta la carpeta de la migración de ida y la app no arranca.

### 4. Desplegar

```bash
git push origin main
```

La migración de vuelta corre sola al arrancar y deja `stock` como estaba.

## Qué se pierde

Nada de lo que había antes. Los 37 productos marcados como "sin contar" vuelven
a valer 0, que es exactamente lo que valían. Lo único que se pierde es la
distinción entre "hay cero" y "nunca se contó" — o sea, se vuelve al problema
que la migración venía a resolver.

## Si todo lo demás falla

Los respaldos diarios están en el bucket `didier-catering-backups`, con catorce
días de retención, y se verificó el 19/08 que restauran de verdad: se bajó el
del día, abrió sano y con todos los datos.
