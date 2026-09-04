# Dashboard Ejecutivo de Ventas — Fagron Colombia

## Qué es esto

Un sitio estático (HTML + CSS + JS) con el dashboard ejecutivo de ventas.
No necesita servidor con backend, base de datos ni instalación de software:
son archivos planos que se suben a cualquier hosting estático (GitHub Pages,
Netlify, un servidor interno, etc.).

## Estructura del Excel fuente (REPORTE_DE_VENTAS.xlsx)

El archivo tiene 3 hojas:

- **`Data 2025-2026`**: el detalle transaccional (una fila por producto
  vendido). Es la fuente de "Evolución de ventas", "Venta por línea",
  "Ventas por zona", "Top clientes" y "Top familias", y de las columnas
  Sem 1 a Sem 5 de la tabla de cumplimiento.
- **`VENTA POR PERIODOS`**: tabla dinámica de referencia (no la usa el
  dashboard directamente).
- **`CUOTAS 2026`**: cuota, realizado, cumplimiento y diferencia por
  representante, mes a mes, agrupados en 4 bloques con espacio entre
  ellos (CENTRO, PERIFERIA, MATERIAS PRIMAS, OTROS). Es la fuente del
  "Resumen ejecutivo" y de la tabla "Cumplimiento de cuota por zona y
  representante". El script detecta automáticamente cuál es el mes en
  curso (el último con cuota cargada en la fila `TOTAL GENERAL 2026`).

**Antes de exportar/guardar el Excel cada semana**, actualiza las
fórmulas y tablas dinámicas de `CUOTAS 2026` (clic derecho → "Actualizar
todo"). Si no lo haces, el dashboard mostrará cifras de la semana pasada.

## Dos formas de abrir esto

Este paquete trae **dos maneras** de ver el dashboard:

1. **`ver_sin_servidor.html`** — ábrelo con doble clic para verlo de inmediato,
   sin subir nada a ningún lado. Trae los datos reales incrustados dentro del
   mismo archivo, así que pesa varios MB, pero funciona sin conexión y sin
   servidor. **Úsalo solo para revisar/aprobar** — no está pensado para el
   uso diario del equipo, porque cada actualización de datos obliga a
   regenerar este archivo completo (ver más abajo).

2. **`index.html` + `data.json`** — esta es la versión para subir al
   hosting real y que use el equipo día a día. Aquí sí puedes actualizar
   `data.json` cada semana sin tocar nada más (ver siguiente sección).

### Por qué `index.html` solo no muestra nada si lo abres con doble clic

Si abres `index.html` directamente desde tu computador (protocolo
`file://`), el navegador bloquea por seguridad que la página lea el
archivo `data.json` con `fetch()`, aunque esté en la misma carpeta —
verás el mensaje "No se pudo cargar data.json". **Esto es una protección
normal del navegador, no un error del paquete.** Una vez subas los
archivos a un hosting real (`http://` o `https://`), esa restricción no
aplica y todo funciona con normalidad. Para probarlo localmente antes de
subirlo, usa `ver_sin_servidor.html`, o corre un servidor local simple:

```
cd carpeta-del-dashboard
python3 -m http.server 8000
```

y abre `http://localhost:8000/index.html` en el navegador.

## Estructura de archivos

```
index.html          <- página principal (no se toca en la actualización semanal)
css/styles.css       <- estilos (marca Fagron)
js/app.js            <- lógica de filtros, tablas y gráficos
js/vendor/chart.umd.min.js  <- librería de gráficos (Chart.js), incluida localmente
assets/logo.png       <- logo Fagron a color (fondos claros)
assets/logo-blanco.png<- logo Fagron blanco (fondos oscuros)
data.json             <- LOS DATOS. Este es el único archivo que cambia cada semana.
data_pipeline/build_data.py <- script que genera data.json a partir del Excel
```

## Cómo subirlo al hosting (primera vez)

Sube TODA la carpeta (manteniendo la estructura de subcarpetas) a la raíz de
tu hosting. Debe quedar accesible como `https://tu-dominio/index.html`.

## Cómo actualizar los datos cada semana

El Excel `REPORTE_DE_VENTAS.xlsx` **no cambia de estructura**, solo se le
agregan filas nuevas de ventas en la hoja `Data 2025-2026` semana a semana.
Cuando lo actualices:

1. **Antes de exportar/guardar el Excel**, actualiza las tablas dinámicas y
   fórmulas de la hoja `REAL GENERAL` (clic derecho → "Actualizar todo", o
   Datos → Actualizar todo). Esa hoja es la que alimenta los KPIs del
   resumen ejecutivo y la tabla de cumplimiento — si no la refrescas antes
   de generar el archivo, el dashboard mostrará cifras de la semana pasada.

2. Corre el script de conversión (requiere Python 3 con `openpyxl`:
   `pip install openpyxl --break-system-packages` si no lo tienes instalado):

   ```
   python3 data_pipeline/build_data.py /ruta/al/REPORTE_DE_VENTAS.xlsx data.json
   ```

   Esto genera un `data.json` nuevo en la carpeta actual. El script imprime
   un resumen (filas leídas, filas agregadas, cantidad de zonas/líneas/
   asesores/clientes/familias detectadas) para que puedas verificar que el
   número de filas leídas corresponde a lo esperado.

3. Sube (reemplaza) únicamente el archivo `data.json` en el hosting. No hace
   falta tocar ningún otro archivo.

## Qué se puede filtrar y qué no

- **Resumen ejecutivo (KPIs) y "Cumplimiento de cuota por zona y
  representante"**: son los valores oficiales ya calculados en la hoja
  `REAL GENERAL` del Excel (cuota, facturado, % cumplimiento del mes en
  curso). **No cambian** al mover los filtros de fecha/zona/línea/asesor de
  la barra superior — siempre muestran el mes de corte oficial.
- **Evolución de ventas, venta por línea, ventas por zona, top clientes,
  top familias**: se calculan en el navegador a partir de la hoja
  `Data 2025-2026` y sí responden a todos los filtros.

## Supuestos y decisiones tomadas al construir esto (léase antes de operar)

- El filtro "Asesor" usa la columna `ASESOR` del Excel (no
  `ASESOR REAL (CRECIMIENTOS)`). El filtro "Zona" usa la columna `ZONA`
  (no `ZONA DE ASESOR REAL`). Si tu equipo necesita las variantes "reales"
  para atribución de crecimiento, hay que ajustar `build_data.py`
  (columnas indicadas por número al inicio del archivo).
- Las columnas Sem 1 a Sem 5 usan la columna `SEMANA` que ya trae
  `Data 2025-2026` (semana 1 = días 1-7 del mes, semana 2 = días 8-14,
  etc.), sumando `VALORES` por representante (`ASESOR`) dentro del mes en
  curso. Los totales de zona y el total general son la suma de sus
  representantes — no vienen de una fórmula del Excel.
- La columna "Gerente" no se muestra en la tabla (para que quepan las 5
  semanas sin scroll horizontal), pero el dato se conserva internamente.
- En la hoja `CUOTAS 2026`, las filas "VENTAS SAC" y "VENTAS EMPLEADOS"
  vienen con ZONA=OTROS, pero en el dashboard se reclasifican a
  ZONA=SAC (a pedido tuyo). Este ajuste está *forzado por nombre* dentro
  de `build_data.py` (diccionario `ZONA_OVERRIDE`) — si esos nombres
  cambian en el Excel, hay que actualizar ese diccionario. Las filas
  "OTROS" (NUTRABIOTICS, RAMEDICAS) no tienen gerente asignado, tal como
  en el Excel original.
- Cuando una celda de cuota o diferencia viene vacía en el Excel (no cero),
  el dashboard muestra "—" o "s/cuota" en vez de inventar un valor de $0.

## Navegadores

Probado en Chromium. Debería funcionar igual en Chrome, Edge y Firefox
recientes. No usa Internet Explorer.
