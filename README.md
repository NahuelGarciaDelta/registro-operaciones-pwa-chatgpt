# DELTA MINING · Registro de Operaciones PWA

PWA Vite + React + TypeScript para ROP02. Guarda primero en el celular, funciona offline después de la primera carga y sincroniza con **Registro para operarios** cuando vuelve internet.

## Ejecutar

Dentro de la carpeta que contiene `package.json`:

```bash
npm install
npm run dev
```

Validación:

```bash
npm run lint
npm run test
npm run build
```

## Listas desplegables

Las opciones se obtienen de las hojas de la planilla:

- **Interno / Equipo:** `EQUIPOS`
- **Operador:** `OPERADORES`
- **Supervisor Delta:** `SUPERVISORES`
- **Supervisor Vial Cliente:** `Supervisor vial cliente`
- **Área de trabajo:** `Area de trabajo`
- **Tarea 1 / Tarea 2:** `Tareas`, filtradas por tipo de equipo

El proyecto incluye `public/bootstrap.json` como respaldo offline, generado desde el archivo suministrado. Cuando el backend está disponible, **ACTUALIZAR LISTAS** trae los valores actuales de Google Sheets.

## Campos automáticos bloqueados

**N° Parte** y **Horómetro inicial** son de solo lectura.

Al seleccionar un Interno:
- `N° Parte = último N° Parte conocido + 1`
- `Horómetro inicial = último Horómetro final conocido`

Al sincronizar, Apps Script vuelve a calcular ambos valores bajo `LockService`, por lo que el servidor es la referencia definitiva.

## Sincronización local: paso obligatorio

Si usás solamente `npm run dev` sin configurar Google, el formulario funciona y guarda offline, pero las cargas quedan pendientes.

Para sincronizar desde localhost seguí `apps-script/README.md`.

Resumen:

1. Pegá `apps-script/Code.gs` en `Extensiones → Apps Script` de **Registro para operarios**.
2. Ejecutá `setupProject()` una vez.
3. Publicá el script como Aplicación web.
4. Creá `.env.local`:

```env
APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
APPS_SCRIPT_SECRET=...
```

5. Reiniciá:

```bash
npm run dev
```

A partir de ahí **Sincronizar ahora** escribe en `R_OP02_JM`.

## Offline

- IndexedDB (Dexie) guarda las cargas antes de enviarlas.
- Si no hay internet, quedan en **Pendientes**.
- Nunca se elimina una carga local hasta recibir confirmación del servidor.
- Reintenta al recuperar internet, cada 30 segundos mientras la app está abierta y mediante **Sincronizar ahora**.
- UUID evita duplicados por reintentos.

## Deploy en Vercel

1. Subí el proyecto a GitHub.
2. Importalo en Vercel.
3. Configurá `APPS_SCRIPT_URL` y `APPS_SCRIPT_SECRET`.
4. Deploy.
5. Abrí la URL una vez con internet y agregala a la pantalla de inicio.
6. Generá el QR con la URL del deploy.

## Reglas incluidas

- OD → `Equipo operativo a disposición`.
- FS → `Equipo fuera de servicio`.
- EM → `Equipo en mantenimiento programado`.
- OD/FS/EM → HF = HI, horas = 0, sin Tarea 2 / Observaciones 2.
- Tareas filtradas por el tipo de equipo.
- Firma táctil guardada en Drive al sincronizar.
- Historial local y cola persistente de pendientes.

## Comportamiento del formulario

- El orden de carga es vertical: Fecha, Interno, Equipo, Operador, Supervisor Delta, Supervisor Vial Cliente, Turno, N° Parte, Proyecto, Área, HI, HF, Horas, estado, Desgaste, Cambio de tareas, Combustible, Aceite, Tareas, Observaciones, Firma y Guardar.
- N° Parte y Horómetro inicial son automáticos y no editables.
- Horómetro final queda vacío al seleccionar un equipo y debe ser ingresado por el operario.
- El selector OD / FS / EM solo aparece cuando Horómetro inicial = Horómetro final. En ese caso es obligatorio indicar el estado.
- Si HF > HI, el selector de estado queda oculto y las tareas se cargan normalmente desde el catálogo correspondiente al equipo.

## Ajustes de formato y validación
- Los registros nuevos escriben `Fecha` como fecha real en Google Sheets y aplican formato `dd/MM/yyyy`.
- `N° Parte`, `Horómetro inicial`, `Horómetro final` y `Cant. Hs.` se guardan con formato entero.
- `Horómetro inicial` y `N° Parte` son automáticos y no editables.
- `Horómetro final` acepta únicamente números enteros y nunca puede ser menor que el horómetro inicial.
- El formulario está agrupado en: DATOS, DATOS DEL EQUIPO, CONSUMIBLES y TAREAS REALIZADAS.

## IMPORTANTE: actualizar Apps Script después de cambios

Cuando reemplaces `apps-script/Code.gs`, **guardar el archivo no actualiza por sí solo la Web App ya desplegada**.

1. En Apps Script ejecutá `setupProject()` una vez. Esto fija la zona horaria y normaliza fechas existentes.
2. Si querés corregir únicamente fechas históricas, podés ejecutar `normalizeDateColumn()`.
3. Luego ir a **Implementar > Gestionar implementaciones > Editar**.
4. Elegir **Nueva versión** y confirmar la implementación.
5. Mantener la misma URL `/exec` en `.env.local` / Vercel.

Las nuevas cargas escriben `Fecha` como una **fecha real de Google Sheets** y fuerzan el formato `dd/MM/yyyy`.

Todos los campos editables son obligatorios salvo `Tarea 2` y `Observaciones 2`, que son opcionales. `OD / FS / EM` solo es obligatorio cuando HI = HF. `Proyecto` permite `JOSE MARIA` y `FILO DEL SOL`.
