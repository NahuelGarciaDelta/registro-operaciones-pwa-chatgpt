import { existsSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const file = '.env.local'

if (existsSync(file)) {
  console.log('.env.local ya existe. No se modificó.')
  process.exit(0)
}

const rl = createInterface({ input, output })
try {
  const url = (await rl.question('APPS_SCRIPT_URL: ')).trim()
  const secret = (await rl.question('APPS_SCRIPT_SECRET: ')).trim()

  if (!url || !secret) {
    console.error('Faltan datos. No se creó .env.local.')
    process.exitCode = 1
  } else {
    writeFileSync(file, `APPS_SCRIPT_URL=${url}\nAPPS_SCRIPT_SECRET=${secret}\n`, { encoding: 'utf8', mode: 0o600 })
    console.log('.env.local creado correctamente. Queda excluido de Git por .gitignore.')
  }
} finally {
  rl.close()
}
