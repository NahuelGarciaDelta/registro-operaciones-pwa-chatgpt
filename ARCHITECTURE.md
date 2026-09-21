# Arquitectura

```text
QR / pantalla de inicio
        ↓
React PWA + Service Worker
        ↓
IndexedDB / Dexie
   ├── catálogos
   ├── pendientes
   └── historial local
        ↓ cuando hay internet
Vercel /api/backend
        ↓
Google Apps Script
   ├── LockService + UUID/idempotencia
   ├── Google Sheets: R_OP02_JM
   └── Google Drive: firmas PNG
```

El guardado local ocurre antes de la red. Un fallo de internet no descarta la carga. El servidor recalcula referencias antes del append para resolver concurrencia entre dispositivos.
