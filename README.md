# Extractos Bancarios

Sistema de **procesamiento automático de extractos del Banco Sabadell** para una
empresa de gestión de comunidades de propietarios. Se sube un **PDF** del
Sabadell; Claude clasifica cada movimiento en un **código de categoría**, y el
sistema **actualiza las celdas** del documento Google Sheets de destino (una
pestaña por comunidad, con formato fijo copiado de la plantilla `48 ESC`).

El sistema **no crea filas nuevas**: solo actualiza (acumulando) las celdas de
las filas de categoría ya definidas, en la columna del mes correspondiente.

Acceso mediante panel web privado con login propio (un único usuario: el dueño).

---

## Stack

| Área        | Tecnología                                   |
| ----------- | -------------------------------------------- |
| Framework   | Next.js 14 (App Router)                      |
| Estilos     | Tailwind CSS (tema oscuro)                   |
| Auth        | NextAuth.js (credenciales propias)           |
| IA          | Anthropic Claude API                         |
| Entrada     | Google Drive + arrastrar y soltar            |
| Salida      | Google Sheets                                |
| Lectura XLS | SheetJS (`xlsx`)                             |
| PDF         | `pdf-parse`                                  |
| Email       | Nodemailer (SMTP, opcional)                  |
| Deploy      | Vercel                                       |

> **Nota sobre el modelo de IA:** el proyecto se especificó con
> `claude-3-5-sonnet-20241022`, que ha sido **retirado** por Anthropic. Por
> defecto se usa el Sonnet actual (`claude-sonnet-5`), ideal para clasificación,
> configurable con la variable `ANTHROPIC_MODEL`.

---

## Arranque local

```bash
npm install
npm run dev
```

Abre <http://localhost:3000>. Copia `.env.example` a `.env.local` y rellena las
variables (mínimo `OWNER_EMAIL`, `OWNER_PASSWORD`, `NEXTAUTH_SECRET`,
`ANTHROPIC_API_KEY` y las credenciales de Google para escribir en Sheets).

```bash
cp .env.example .env.local
# genera el secreto de sesión:
openssl rand -base64 32
```

---

## Cómo funciona

1. **Entrada** — arrastras un **PDF del Sabadell** al panel, o Google Drive
   dispara el webhook.
2. **Lectura del PDF** (`lib/sabadell.ts`) — con `pdf-parse` se extrae el
   encabezado (`Cuenta`, `Titular`, `Selección`) y los movimientos. Patrón de
   cada movimiento: `F.Operativa  Concepto  F.Valor  Importe  Saldo  Ref1 Ref2`.
   El **Titular** identifica la comunidad (= nombre de la pestaña).
3. **Pestaña de la comunidad** (`lib/sheets.ts`) — si la pestaña no existe, se
   **copia la plantilla `48 ESC`**, se renombra con el titular, se limpian sus
   valores numéricos (dejando la estructura: códigos, descripciones, cabeceras y
   fórmulas de TOTAL) y se actualiza el encabezado. Si ya existe, se usa tal cual.
4. **Clasificación** (`lib/claude.ts`) — para cada gasto, Claude devuelve el
   **código de categoría** (`010`, `020`, …) o `IGNORAR` (ingresos). Los importes
   positivos (remesas, transferencias recibidas) se ignoran.
5. **Actualización de celdas** (`lib/pipeline.ts`) — por cada gasto: se busca la
   fila del código (columna A) y la columna del mes (fila 2, meses en catalán,
   año fiscal set→ago según la fecha operativa) y se **suma** el importe (en
   positivo) al valor existente de esa celda. **Nunca se crean filas.**
6. **Pendientes** — si Claude no identifica el concepto, o no se encuentra la
   celda destino, el movimiento va a la pestaña `Pendiente Revision`
   (`fecha | concepto | importe | comunidad | sugerencia`).
7. **Resumen** — el panel muestra una tabla
   `Concepto | Categoría | Mes | Importe | Celda anterior | Celda nueva`, con
   totales por categoría y por mes.
8. **Sin duplicados** — se guarda el hash SHA-256 de cada PDF en `_Procesados`;
   como los importes se **suman**, reprocesar exige marcar **"Forzar reproceso"**.

### Estructura de la pestaña (plantilla `48 ESC`)

- **Fila 1**: encabezado (número de comunidad y dirección).
- **Fila 2**: meses en catalán → `set oct nov des gener febrer març abr mai jun jul ago`.
- **Filas de categoría** (columna A = código, columna B = descripción):
  `010 Electra · 011 Manteniment elèctric BT · 020 Aigua · 030 Mant. Ascensor
  ASZENDE · 040 Assegurança · 050 Extintors · 051 Extintors Revisió Trimestral ·
  060 Neteja · 140 Mant. Sifons · 174 CAE (PRL) · 175 Cert. Digital · 200
  Honoraris Admin · 201 IVA Administració · 215 Protecció Dades · 230 Despeses
  banc · 231 Despeses RMR`.
- **Fila TOTAL** y sección **Pagaments extraordinaris**: no se tocan (salvo que
  un concepto mapee explícitamente a ellas).

### Documento destino

Google Sheets ID `1oMKW-2p-C53aZLH_sklXcefZJnpAEDGo` (variable
`GOOGLE_SHEETS_ID`). La pestaña `48 ESC` es la plantilla base.

> **Importante — debe ser un Google Sheet nativo.** El documento destino tiene
> que ser un Google Sheet nativo, **no** un archivo Excel (`.xls`/`.xlsx`)
> subido a Drive. La API de Google Sheets no puede operar sobre archivos Office
> aunque estén almacenados en Drive. Si el documento se creó subiendo un `.xls`,
> ábrelo en Google Drive → **Archivo → Guardar como Google Sheets** y usa el ID
> del nuevo documento. Si no, verás el error: _«El documento de destino debe ser
> un Google Sheet nativo…»_.

### Procesamiento del PDF (cliente + servidor por fases)

Para no superar los límites del plan hobby de Vercel (4,5 MB por petición y 10 s
por función), el PDF se procesa así:

1. **Navegador** — el texto del PDF se extrae en el cliente con `pdf.js`; al
   servidor solo se envía el texto plano (mucho más pequeño que el PDF).
2. **`/api/process/parse`** — valida el Sheet destino, detecta duplicados y
   separa gastos de ingresos.
3. **`/api/process/classify`** — clasifica los conceptos en lotes cortos.
4. **`/api/process/apply`** — actualiza las celdas del Sheet.

Cada fase es una petición corta, muy por debajo del límite de 10 s. Los errores
se devuelven siempre como JSON con el mensaje exacto, que se muestra en la
interfaz (ya no aparece un genérico «Error de red»).

---

## Despliegue en Vercel

### Paso 1 — Crear cuenta en Vercel

Entra en <https://vercel.com> y crea una cuenta (puedes usar tu cuenta de GitHub).

### Paso 2 — Conectar el repositorio de GitHub

1. Sube este proyecto a un repositorio de GitHub.
2. En Vercel: **Add New… → Project → Import** y selecciona el repositorio.
3. Vercel detecta Next.js automáticamente. No cambies los ajustes de build.
4. Antes de desplegar, añade las variables de entorno (Paso 4).

### Paso 3 — Crear un Service Account en Google Cloud

El sistema escribe en Google Sheets y lee de Google Drive con una **cuenta de
servicio** (no requiere que un humano inicie sesión).

1. Ve a <https://console.cloud.google.com> y crea (o elige) un proyecto.
2. **APIs y servicios → Biblioteca** → activa **Google Sheets API** y **Google
   Drive API**.
3. **APIs y servicios → Credenciales → Crear credenciales → Cuenta de servicio**.
   Dale un nombre (p. ej. `extractos-bot`) y créala.
4. En la cuenta de servicio → pestaña **Claves → Agregar clave → Crear clave
   nueva → JSON**. Se descarga un archivo JSON. De ahí obtienes:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY`
5. **Comparte los recursos con el email de la cuenta de servicio** (¡paso
   imprescindible!):
   - Abre el **Google Sheet** (ID `1oMKW-2p-C53aZLH_sklXcefZJnpAEDGo`)
     → **Compartir** → añade el `client_email` como **Editor**.
   - Abre la **carpeta de Drive** (ID `1A3LX320kw8kxbcjnznMVY_MPgMUKLTWz`) →
     **Compartir** → añade el `client_email` como **Lector**.

> **`GOOGLE_PRIVATE_KEY`:** al pegarla en Vercel, mantén los saltos de línea como
> `\n` literales y todo entre comillas, tal cual aparece en `.env.example`.

### Paso 4 — Añadir variables de entorno en Vercel

En **Project → Settings → Environment Variables**, añade (ver `.env.example`):

| Variable | Descripción |
| -------- | ----------- |
| `OWNER_EMAIL` | Email de acceso del dueño |
| `OWNER_PASSWORD` | Contraseña de acceso del dueño |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | URL pública, p. ej. `https://extractos-bancarios.vercel.app` |
| `ANTHROPIC_API_KEY` | Clave de la API de Anthropic |
| `ANTHROPIC_MODEL` | (opcional) por defecto `claude-sonnet-5` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` del JSON |
| `GOOGLE_PRIVATE_KEY` | `private_key` del JSON (con `\n` literales) |
| `GOOGLE_SHEETS_ID` | `1oMKW-2p-C53aZLH_sklXcefZJnpAEDGo` |
| `GOOGLE_DRIVE_FOLDER_ID` | `1A3LX320kw8kxbcjnznMVY_MPgMUKLTWz` |
| `SUPERVISOR_EMAIL` | `joelsanchezworks@gmail.com` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | (opcional) para avisos por email |
| `WEBHOOK_SECRET` | (opcional) protege el endpoint `/api/webhook` |

Vuelve a desplegar tras guardar las variables.

### Paso 5 — Configurar el webhook de Google Drive

Tienes dos opciones para procesar automáticamente los archivos que llegan a la
carpeta de Drive:

**Opción A — Google Apps Script (recomendada, más sencilla).**
Crea un Apps Script con un disparador que, al detectar un archivo nuevo en la
carpeta, haga una petición `POST` a tu endpoint:

```js
function notificarNuevoArchivo(fileId) {
  UrlFetchApp.fetch('https://TU-APP.vercel.app/api/webhook', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-webhook-token': 'TU_WEBHOOK_SECRET' }, // si usas WEBHOOK_SECRET
    payload: JSON.stringify({ fileId: fileId }),
  });
}
```

**Opción B — Drive Push Notifications (`files.watch`).**
Registra un canal de notificaciones sobre la carpeta. Cuando Drive avisa de un
cambio, el endpoint escanea la carpeta y procesa los archivos nuevos (los ya
procesados se ignoran por hash). El endpoint responde al handshake `sync` de
Drive automáticamente.

En ambos casos, si defines `WEBHOOK_SECRET`, el endpoint exige el token en la
cabecera `x-webhook-token` o en `?token=`.

También puedes procesar la carpeta manualmente con:

```bash
curl -X POST "https://TU-APP.vercel.app/api/webhook?token=TU_WEBHOOK_SECRET"
```

### Paso 6 — Primera prueba con un PDF real del Sabadell

1. Asegúrate de que la pestaña **`48 ESC`** existe en el Google Sheet de destino
   (es la plantilla que se copia para cada comunidad nueva).
2. Entra en `https://TU-APP.vercel.app`, inicia sesión con `OWNER_EMAIL` /
   `OWNER_PASSWORD`.
3. Arrastra un extracto **PDF** real del Sabadell.
4. Verás la barra de progreso: *Leyendo PDF → Verificando pestaña → Clasificando
   → Actualizando celdas → Completado*, y la tabla resumen con las celdas
   actualizadas (anterior → nueva).
5. Abre el Google Sheet (botón **Ver Google Sheet completo**): la pestaña de la
   comunidad tendrá las celdas actualizadas, y los dudosos en `Pendiente Revision`.

### Paso 7 — Cambiar el email y la contraseña del dueño

Las credenciales están en variables de entorno (no hay base de datos de
usuarios). Para cambiarlas:

1. En Vercel: **Settings → Environment Variables** → edita `OWNER_EMAIL` y/o
   `OWNER_PASSWORD`.
2. **Redeploy** el proyecto (Deployments → … → Redeploy) para aplicar los cambios.
3. En local, edita `.env.local` y reinicia `npm run dev`.

---

## Estructura del proyecto

```
/
├── app/
│   ├── login/page.tsx            # pantalla de login (tema oscuro)
│   ├── page.tsx                  # dashboard (protegido)
│   ├── layout.tsx                # layout raíz + SessionProvider
│   ├── globals.css
│   ├── providers.tsx
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── process/route.ts      # subida por drag & drop
│       ├── webhook/route.ts      # entrada desde Google Drive
│       └── stats/route.ts        # estadísticas del dashboard
├── components/
│   ├── Dashboard.tsx
│   ├── DropZone.tsx
│   ├── ResultsTable.tsx
│   ├── StatsBar.tsx
│   ├── CategoryBadge.tsx
│   ├── CommunityList.tsx
│   └── SpendingChart.tsx
├── lib/
│   ├── auth.ts                   # opciones de NextAuth
│   ├── claude.ts                 # clasificación con Claude
│   ├── sheets.ts                 # Google Sheets
│   ├── drive.ts                  # Google Drive
│   ├── parser.ts                 # XLS/CSV/PDF → movimientos
│   ├── email.ts                  # avisos SMTP
│   ├── pipeline.ts               # orquestación del procesado
│   ├── categories.ts             # categorías y colores
│   └── types.ts
├── middleware.ts                 # protege rutas / redirige login
├── .env.example
└── README.md
```

---

## Consideraciones técnicas

- SheetJS maneja igual XLS antiguo y XLSX moderno; siempre se usa la primera hoja.
- Importes españoles `"1.234,56"` se normalizan a `1234.56`.
- Si Claude devuelve texto extra, se extrae el array JSON con una búsqueda de
  corchetes.
- Los errores no rompen el flujo: se marca `revisar: true`.
- No se reprocesan duplicados: se guarda el hash del archivo.
- Límite de 4.5 MB de Vercel: los extractos grandes se envían a Claude en lotes.
- `middleware.ts` redirige a `/` si ya hay sesión al visitar `/login`, y a
  `/login` si no hay sesión en rutas protegidas.
- Las categorías tienen colores fijos (badges): verde (Luz, Agua), azul (Seguro,
  Cuotas), naranja (Reparacion Electrica, Fontaneria), amarillo (Jardineria,
  Limpieza), gris (Otros), rojo (Pendiente Revision).
