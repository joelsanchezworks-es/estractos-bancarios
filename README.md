# Extractos Bancarios

Sistema completo de **clasificación automática de extractos bancarios** para una
empresa de gestión de comunidades de propietarios. Sube un extracto (XLS, XLSX,
CSV o PDF), Claude clasifica cada movimiento por categoría, y el resultado se
escribe automáticamente en Google Sheets (una pestaña por comunidad).

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

1. **Entrada** — arrastras un archivo al panel, o Google Drive dispara el webhook.
2. **Parseo** (`lib/parser.ts`) — detecta el tipo y normaliza a
   `[{ fecha, descripcion, importe }]`:
   - **XLS/XLSX**: primera hoja (índice 0), detección automática de columnas
     (`Fecha`, `Concepto`, `Importe`, o `Cargo`/`Abono` por separado). Si hay
     `Cargo` y `Abono`, `importe = abono - cargo`.
   - **CSV**: detección de delimitador (`,` o `;`), gestión de comillas,
     codificación UTF-8 con respaldo latin-1.
   - **PDF**: extracción de texto y búsqueda de patrones fecha + descripción +
     importe.
   - Limpieza de importes españoles: `"1.234,56"` → `1234.56`.
3. **Clasificación** (`lib/claude.ts`) — Claude asigna una de las categorías
   exactas: `Luz, Agua, Seguro, Reparacion Electrica, Fontaneria, Jardineria,
   Limpieza, Cuotas, Otros`, con nivel de confianza y marca de revisión. Se
   procesa en lotes (máx. 50 movimientos / ~6000 caracteres por petición). Los
   errores no rompen el flujo: los movimientos afectados se marcan para revisión.
4. **Escritura en Sheets** (`lib/sheets.ts`) — crea la pestaña de la comunidad si
   no existe, añade cabeceras si está vacía. Movimientos correctos → pestaña de
   la comunidad; movimientos con `revisar: true` → pestaña `Pendiente Revision`;
   **todos** los movimientos → pestaña `Extractos` (libro maestro con todas las
   comunidades, usado también para los contadores del dashboard).
5. **Email** (`lib/email.ts`) — si hay pendientes, avisa a `SUPERVISOR_EMAIL`
   (requiere SMTP configurado; si no, se omite sin romper el flujo).
6. **Sin duplicados** — se guarda el hash SHA-256 de cada archivo en la pestaña
   `_Procesados`; los archivos ya procesados se ignoran. Para reprocesar el mismo
   archivo (p. ej. al hacer pruebas), marca **"Forzar reproceso"** en el panel
   antes de subirlo. Para vaciar por completo el registro, elimina la pestaña
   `_Procesados` del Google Sheet (se recrea sola en el siguiente procesado).

### Convención de nombres

`ComunidadRosas_20240115.xls` → comunidad = `ComunidadRosas` → pestaña
`ComunidadRosas`.

### Columnas en Sheets

**Pestaña de comunidad:**
`fecha | descripcion | importe | categoria | confianza | comunidad | archivo_origen | fecha_proceso`

**Pestaña `Pendiente Revision`:**
`fecha | descripcion | importe | categoria_sugerida | confianza | comunidad | archivo_origen | fecha_proceso | categoria_final`

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
   - Abre el **Google Sheet** (ID `1TgTz4VtfQJOUolWVUIUEj-yx4GjB27XgNGWQGVUe82M`)
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
| `GOOGLE_SHEETS_ID` | `1TgTz4VtfQJOUolWVUIUEj-yx4GjB27XgNGWQGVUe82M` |
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

### Paso 6 — Primera prueba con un XLS real

1. Entra en `https://TU-APP.vercel.app`, inicia sesión con `OWNER_EMAIL` /
   `OWNER_PASSWORD`.
2. Arrastra un extracto real llamado, por ejemplo, `NombreComunidad_20240131.xls`.
3. Verás la barra de progreso: *Leyendo → Claude clasificando → Escribiendo en
   Sheets → Completado*, y la tabla de resultados.
4. Abre el Google Sheet (botón **Ver Google Sheet completo**): habrá una pestaña
   con el nombre de la comunidad y, si hubo dudas, filas en `Pendiente Revision`.

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
