# Conectar la PWA con "Registro para operarios"

La sincronización necesita este Apps Script. Es un paso único.

## 1. Crear el Apps Script

1. Abrí **Registro para operarios** en Google Sheets.
2. `Extensiones → Apps Script`.
3. Reemplazá todo `Code.gs` por el archivo `apps-script/Code.gs` de este proyecto.
4. Guardá.

## 2. Configuración automática

En el selector de funciones elegí:

```text
setupProject
```

Ejecutalo una vez y autorizá los permisos.

La función hace automáticamente:
- guarda el ID de la planilla;
- crea una carpeta de Drive para las firmas;
- genera un `API_SECRET`.

Abrí **Registro de ejecución**. Vas a ver un JSON con `apiSecret`. Copialo.

## 3. Publicar el Web App

1. `Implementar → Nueva implementación`.
2. Tipo: **Aplicación web**.
3. Ejecutar como: **Yo**.
4. Quién tiene acceso: **Cualquiera**.
5. Implementar.
6. Copiar la URL que termina en `/exec`.

El Web App queda protegido por el secreto que conoce solamente el backend de la PWA.

## 4. Probar con `npm run dev`

En la raíz del proyecto creá un archivo `.env.local`:

```env
APPS_SCRIPT_URL=https://script.google.com/macros/s/XXXXXXXX/exec
APPS_SCRIPT_SECRET=EL_SECRETO_QUE_MOSTRO_setupProject
```

Después reiniciá Vite:

```bash
npm run dev
```

**Importante:** cada vez que cambies `.env.local`, reiniciá `npm run dev`.

Ahora `Sincronizar ahora` funciona también desde localhost. Vite mantiene el secreto del lado servidor y el navegador nunca lo recibe.

## 5. Producción en Vercel

Crear las mismas dos variables en Vercel:

```env
APPS_SCRIPT_URL=...
APPS_SCRIPT_SECRET=...
```

No uses prefijo `VITE_` para estos secretos.

## Catálogos

Cada `bootstrap` lee directamente:
- `EQUIPOS`
- `OPERADORES`
- `SUPERVISORES`
- `Tareas`
- `Area de trabajo`
- `Supervisor vial cliente`

El botón **ACTUALIZAR LISTAS** de la PWA vuelve a consultar esas hojas.
