import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.env.PLAYWRIGHT_BROWSERS_PATH ||= join(projectRoot, '.playwright-browsers')
const { chromium, devices, webkit } = await import('@playwright/test')
const migrationsDir = join(projectRoot, 'pb_migrations')
const publicDir = join(projectRoot, 'dist')
const outputDir = join(projectRoot, 'docs', 'screenshots')
const dataRoot = await mkdtemp(join(tmpdir(), 'ersatzteillager-screenshots-'))
const dataDir = join(dataRoot, 'pb_data')
const pocketBase = join(projectRoot, 'tools', process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const demoEmail = 'screenshots@example.invalid'
const superuserEmail = 'screenshots-superuser@example.invalid'
const demoPassword = `${randomBytes(18).toString('hex')}Aa1!`
const maxPngBytes = 300 * 1024
const screenshots = [
  'mobile-bestandsliste.png',
  'mobile-teil-entnahme.png',
  'desktop-uebersicht.png',
  'desktop-verlauf.png',
]

let pocketBaseProcess
let mobileBrowser
let desktopBrowser

function run(command, args, label, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: options.quiet ? 'ignore' : 'inherit',
    windowsHide: true,
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
  })
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || `Exit-Code ${result.status ?? 'unbekannt'}`
    throw new Error(`${label} fehlgeschlagen (${detail}).`)
  }
}

async function getFreePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Kein freier Loopback-Port verfügbar.'))
        return
      }
      server.close(() => resolvePort(address.port))
    })
  })
}

async function waitForHealth(baseUrl) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      // PocketBase startet noch.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error('Die temporäre PocketBase-Instanz wurde nicht erreichbar.')
}

async function api(baseUrl, endpoint, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      ...(token ? { Authorization: token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    throw new Error(`Testdaten-Anfrage fehlgeschlagen (${response.status}, ${endpoint}).`)
  }
  if (response.status === 204) return null
  return await response.json()
}

async function seedDemoData(baseUrl) {
  const auth = await api(baseUrl, '/api/collections/_superusers/auth-with-password', {
    method: 'POST',
    body: { identity: superuserEmail, password: demoPassword },
  })
  const token = auth.token
  const user = await api(baseUrl, '/api/collections/users/records', {
    token,
    method: 'POST',
    body: {
      email: demoEmail,
      password: demoPassword,
      passwordConfirm: demoPassword,
      name: 'Demo-Administrator',
      is_admin: true,
    },
  })

  const categoryNames = ['Befestigung', 'Elektrotechnik', 'Dichtungen', 'Mechanik']
  const categories = new Map()
  for (const name of categoryNames) {
    const record = await api(baseUrl, '/api/collections/categories/records', {
      token,
      method: 'POST',
      body: { name, description: `Neutrale Demokategorie ${name}` },
    })
    categories.set(name, record.id)
  }

  const partDefinitions = [
    {
      name: 'Schraube M6x20', article_number: 'SCH-M6-20', category: 'Befestigung', quantity: 42, min_quantity: 20,
      price: 0.18, location_number: 'A-01', location_place: 'Fach 2', installation_location: 'Montageplatz 1',
      technical_data: 'M6 × 20 mm · verzinkt', description: 'Universelle Sechskantschraube für Montagearbeiten.',
    },
    {
      name: 'Sicherung 16 A', article_number: 'SICH-16A', category: 'Elektrotechnik', quantity: 4, min_quantity: 6,
      price: 1.25, location_number: 'B-03', location_place: 'Fach 1', installation_location: 'Schaltschrank 2',
      technical_data: '16 A · 500 V · träge', description: 'Ersatzsicherung für abgesicherte Stromkreise.',
    },
    {
      name: 'Kugellager 6204', article_number: 'KL-6204', category: 'Mechanik', quantity: 10, min_quantity: 4,
      price: 8.9, location_number: 'C-02', location_place: 'Schublade 4', installation_location: 'Antrieb 1',
      technical_data: '20 × 47 × 14 mm', description: 'Rillenkugellager für allgemeine Reparaturen.',
    },
    {
      name: 'Dichtung 20x3', article_number: 'D-20-3', category: 'Dichtungen', quantity: 30, min_quantity: 10,
      price: 0.65, location_number: 'D-01', location_place: 'Box 3', installation_location: 'Prüfstand',
      technical_data: '20 × 3 mm · NBR', description: 'Neutrale Runddichtung für Wartungszwecke.',
    },
    {
      name: 'Filtereinsatz 100 mm', article_number: 'FIL-100', category: 'Mechanik', quantity: 7, min_quantity: 4,
      price: 5.4, location_number: 'C-05', location_place: 'Fach 2', installation_location: 'Absaugung',
      technical_data: 'Durchmesser 100 mm', description: 'Austauschbarer Filtereinsatz für regelmäßige Wartung.',
    },
  ]

  const parts = new Map()
  for (const definition of partDefinitions) {
    const { category, ...fields } = definition
    const record = await api(baseUrl, '/api/collections/spare_parts/records', {
      token,
      method: 'POST',
      body: {
        ...fields,
        category_id: categories.get(category),
        unit: 'Stk',
        location_type: 'R',
        anlage: 'Demobereich',
        manufacturer: '',
        supplier: '',
        additional_info: '',
        link: '',
        attachment: '',
        qr_code: fields.article_number,
        location_data: { display_code: `R.${fields.location_number} P.${fields.location_place}` },
      },
    })
    parts.set(record.name, record)
  }

  const movements = [
    ['Dichtung 20x3', 'in', 30, 0, 30, 'Lieferung/Wareneingang', 'Erstbestand erfasst'],
    ['Filtereinsatz 100 mm', 'in', 7, 0, 7, 'Inventur/Korrektur', 'Bestand ergänzt'],
    ['Kugellager 6204', 'in', 12, 0, 12, 'Lieferung/Wareneingang', 'Wareneingang geprüft'],
    ['Kugellager 6204', 'out', 2, 12, 10, 'Reparatur/Instandhaltung', 'Für Wartung entnommen'],
    ['Schraube M6x20', 'in', 50, 0, 50, 'Lieferung/Wareneingang', 'Erstbestand erfasst'],
    ['Schraube M6x20', 'out', 8, 50, 42, 'Reparatur/Instandhaltung', 'Für Montage entnommen'],
    ['Sicherung 16 A', 'in', 20, 0, 20, 'Lieferung/Wareneingang', 'Bestand ergänzt'],
    ['Sicherung 16 A', 'out', 16, 20, 4, 'Reparatur/Instandhaltung', 'Für Wartung entnommen'],
  ]
  for (const [partName, action, quantity, previousQuantity, newQuantity, reason, notes] of movements) {
    await api(baseUrl, '/api/collections/inventory_log/records', {
      token,
      method: 'POST',
      body: {
        spare_part_id: parts.get(partName).id,
        action,
        quantity,
        previous_quantity: previousQuantity,
        new_quantity: newQuantity,
        reason,
        notes,
        user_name: 'Demo-Konto',
        user_agent: 'Screenshot-Generator',
        supplier: '',
        order_number: '',
        delivery_note_number: '',
        metadata: { source: 'manual_demo' },
      },
    })
  }

  return user.id
}

async function preparePage(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addStyleTag({
    content: '* { animation: none !important; transition: none !important; caret-color: transparent !important; }',
  })
  await page.evaluate(async () => { await document.fonts.ready })
}

async function login(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('name@beispiel.de').fill(demoEmail)
  await page.getByPlaceholder('••••••••').fill(demoPassword)
  await page.getByRole('button', { name: 'Einloggen' }).click()
  await page.getByRole('navigation', { name: 'Hauptnavigation und Verwaltung' }).waitFor()
  await preparePage(page)
}

async function assertSafePage(page, label) {
  const visibleText = await page.locator('body').innerText()
  const forbidden = [
    /@gmail\.com/i,
    /@proton\.me/i,
    /C:\\Users\\/i,
    /C:\\PROJEKTS/i,
    /\/Users\//i,
    /\bWadim\b/i,
    /\bREXEL\b/i,
    /\bBLG\b/i,
    /Dalheimer/i,
  ]
  const match = forbidden.find((pattern) => pattern.test(visibleText))
  if (match) throw new Error(`${label} enthält einen unzulässigen sichtbaren Wert (${match}).`)
}

async function saveScreenshot(page, fileName, label) {
  await assertSafePage(page, label)
  const outputPath = join(outputDir, fileName)
  await page.screenshot({
    path: outputPath,
    type: 'png',
    scale: 'css',
    animations: 'disabled',
    caret: 'hide',
  })
  const { size } = await stat(outputPath)
  if (size >= maxPngBytes) {
    throw new Error(`${fileName} ist mit ${Math.ceil(size / 1024)} KB größer als 300 KB.`)
  }
  console.log(`${relative(projectRoot, outputPath)}: ${Math.ceil(size / 1024)} KB`)
}

async function createScreenshots(baseUrl, userId) {
  mobileBrowser = await webkit.launch()
  const mobileContext = await mobileBrowser.newContext({ ...devices['iPhone 13'], locale: 'de-DE' })
  await mobileContext.addInitScript(({ id }) => {
    localStorage.setItem(`ersatzteillager.mobile-setup.v1.${id}`, JSON.stringify({ step: 4, complete: true }))
  }, { id: userId })
  const mobilePage = await mobileContext.newPage()
  await login(mobilePage, baseUrl)
  await mobilePage.getByRole('button', { name: 'Bestand', exact: true }).click()
  await mobilePage.getByRole('heading', { name: 'Bestand', exact: true }).waitFor()
  const articleHeading = mobilePage.getByRole('heading', { name: 'Artikel', exact: true })
  await articleHeading.scrollIntoViewIfNeeded()
  await mobilePage.evaluate(() => window.scrollBy(0, -110))
  await saveScreenshot(mobilePage, 'mobile-bestandsliste.png', 'Mobile Bestandsliste')

  await mobilePage.getByRole('button', { name: /Schraube M6x20/ }).click()
  const partHeading = mobilePage.getByRole('heading', { name: 'Schraube M6x20', exact: true })
  await partHeading.scrollIntoViewIfNeeded()
  await partHeading.evaluate((element) => window.scrollBy(0, element.getBoundingClientRect().top - 150))
  await mobilePage.getByRole('button', { name: /Entnahme$/ }).waitFor()
  await saveScreenshot(mobilePage, 'mobile-teil-entnahme.png', 'Mobile Teilansicht mit Entnahme')
  await mobileContext.close()
  await mobileBrowser.close()
  mobileBrowser = undefined

  desktopBrowser = await chromium.launch()
  const desktopContext = await desktopBrowser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' })
  await desktopContext.addInitScript(({ id }) => {
    localStorage.setItem(`ersatzteillager.mobile-setup.v1.${id}`, JSON.stringify({ step: 4, complete: true }))
  }, { id: userId })
  const desktopPage = await desktopContext.newPage()
  await login(desktopPage, baseUrl)
  await desktopPage.getByText('Gesamt Ersatzteile').waitFor()
  await saveScreenshot(desktopPage, 'desktop-uebersicht.png', 'Desktop-Übersicht')

  await desktopPage.getByRole('button', { name: 'Historie', exact: true }).click()
  await desktopPage.getByRole('heading', { name: 'Buchungshistorie', exact: true }).waitFor()
  await saveScreenshot(desktopPage, 'desktop-verlauf.png', 'Desktop-Verlauf')
  await desktopContext.close()
  await desktopBrowser.close()
  desktopBrowser = undefined
}

async function cleanup() {
  await mobileBrowser?.close().catch(() => undefined)
  await desktopBrowser?.close().catch(() => undefined)
  if (pocketBaseProcess && pocketBaseProcess.exitCode === null) {
    pocketBaseProcess.kill()
    await Promise.race([
      new Promise((resolveExit) => pocketBaseProcess.once('exit', resolveExit)),
      new Promise((resolveWait) => setTimeout(resolveWait, 3000)),
    ])
    if (pocketBaseProcess.exitCode === null) pocketBaseProcess.kill('SIGKILL')
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(dataRoot, { recursive: true, force: true })
      break
    } catch {
      if (attempt === 4) throw new Error('Der temporäre Screenshot-Testordner konnte nicht entfernt werden.')
      await new Promise((resolveWait) => setTimeout(resolveWait, 300))
    }
  }
}

try {
  await access(pocketBase)
  run(npmCommand, ['run', 'build'], 'Produktions-Build')
  await mkdir(dataDir, { recursive: true })
  await mkdir(outputDir, { recursive: true })
  for (const fileName of screenshots) await rm(join(outputDir, fileName), { force: true })

  run(pocketBase, [
    '--dir', dataDir,
    '--migrationsDir', migrationsDir,
    '--publicDir', publicDir,
    'superuser', 'upsert', superuserEmail, demoPassword,
  ], 'Initialisierung der temporären PocketBase', { quiet: true })

  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  pocketBaseProcess = spawn(pocketBase, [
    '--dir', dataDir,
    '--migrationsDir', migrationsDir,
    '--publicDir', publicDir,
    '--indexFallback=true',
    'serve',
    `--http=127.0.0.1:${port}`,
    `--origins=${baseUrl}`,
  ], { cwd: projectRoot, stdio: 'ignore', windowsHide: true })
  await waitForHealth(baseUrl)
  const userId = await seedDemoData(baseUrl)
  await createScreenshots(baseUrl, userId)

  const files = await Promise.all(screenshots.map(async (fileName) => ({
    fileName,
    bytes: (await stat(join(outputDir, fileName))).size,
    signature: (await readFile(join(outputDir, fileName))).subarray(0, 8).toString('hex'),
  })))
  if (files.some((file) => file.signature !== '89504e470d0a1a0a')) throw new Error('Mindestens eine Ausgabedatei ist kein gültiges PNG.')
  console.log(`Erstellt: ${files.length} neutrale README-Screenshots.`)
} finally {
  await cleanup()
}
