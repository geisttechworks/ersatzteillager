import { expect, test, type Page } from '@playwright/test'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

async function installCameraFailure(page: Page, errorName: string, delayMs = 0) {
  await page.evaluate(({ name, delay }) => {
    const testWindow = window as typeof window & {
      __cameraCallCount?: number
      __cameraConstraints?: MediaStreamConstraints[]
    }
    testWindow.__cameraCallCount = 0
    testWindow.__cameraConstraints = []
    const mediaDevices = navigator.mediaDevices ?? {}
    Object.defineProperty(mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        testWindow.__cameraCallCount = (testWindow.__cameraCallCount ?? 0) + 1
        testWindow.__cameraConstraints?.push(constraints)
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
        throw new DOMException('Synthetic camera failure', name)
      },
    })
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices })
    }
  }, { name: errorName, delay: delayMs })
}

async function login(page: Page) {
  await page.goto('/')
  await page.getByPlaceholder('name@beispiel.de').fill(email!)
  await page.getByPlaceholder('••••••••').fill(password!)
  await page.getByRole('button', { name: 'Einloggen' }).click()
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation und Verwaltung' })).toBeVisible()
}

test.describe('Lagerabläufe in einer frischen Test-PocketBase', () => {
  test.skip(!email || !password, 'E2E_EMAIL und E2E_PASSWORD eines eigens angelegten Testbenutzers setzen.')

  test('Anmeldung, Teil, Zu-/Abgang, Lieferschein-Duplikat und Benutzerverwaltung', async ({ page }) => {
    await page.addInitScript(() => {
      const mockStream = { getTracks: () => [{ stop: () => undefined }] }
      if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {} })
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => mockStream })
    })

    await page.goto('/installieren')
    await expect(page.getByRole('heading', { name: 'Ersatzteillager installieren' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Zur Anmeldung/ })).toBeVisible()

    await page.goto('/')
    await expect(page.getByText('Passwort vergessen? Wenden Sie sich an den Admin.')).toBeVisible()
    await expect(page.getByRole('link', { name: /App installieren/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Reset-E-Mail anfordern/ })).toHaveCount(0)
    await page.getByPlaceholder('name@beispiel.de').fill(email!)
    await page.getByPlaceholder('••••••••').fill(password!)
    await page.getByRole('button', { name: 'Einloggen' }).click()

    await expect(page.getByRole('heading', { name: 'App zum Startbildschirm hinzufügen' })).toBeVisible()
    await page.getByRole('button', { name: 'Weiter', exact: true }).click()
    await page.getByRole('button', { name: 'Kamera prüfen' }).click()
    await expect(page.getByText(/Kamera wurde erfolgreich erkannt/)).toBeVisible()
    await page.getByRole('button', { name: 'Weiter zur Testbuchung' }).click()
    await page.getByRole('button', { name: 'Testbuchung starten' }).click()

    await expect(page.getByRole('navigation', { name: 'Hauptnavigation und Verwaltung' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Bestand', exact: true })).toBeVisible()
    await expect(page.locator('button[title="Etiketten drucken"]')).toBeHidden()
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
    }))
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 2)

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`
    const partName = `E2E-Testteil ${suffix}`
    await page.getByRole('button', { name: /Kein Teil vorhanden: anlegen/ }).click()
    await page.getByPlaceholder('z.B. Widerstand 10kΩ').fill(partName)
    await page.getByPlaceholder('z.B. RES-10K-001').fill(`E2E-${suffix}`)
    await page.getByRole('button', { name: /Ersatzteil erstellen/ }).click()

    await page.getByRole('button', { name: new RegExp(partName) }).click()
    await page.getByRole('button', { name: 'Zugang', exact: true }).click()
    await page.locator('input[type="number"]').last().fill('5')
    await page.getByRole('button', { name: 'Zugang buchen' }).click()
    await expect(page.getByRole('heading', { name: 'Einrichtung abgeschlossen' })).toBeVisible()
    await page.getByRole('button', { name: 'Einrichtung abschließen' }).click()
    await page.getByRole('button', { name: /Entnahme$/ }).click()
    await page.locator('input[type="number"]').last().fill('2')
    await page.getByRole('button', { name: 'Abgang buchen' }).click()

    await page.getByRole('button', { name: 'Historie', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Drucken' })).toBeHidden()

    await page.getByRole('button', { name: 'Bestand', exact: true }).click()
    await page.getByRole('button', { name: /Lieferschein importieren/ }).click()
    await page.getByRole('button', { name: 'Manuellen Weg starten' }).click()
    await page.getByRole('button', { name: 'Ich habe schon JSON – weiter' }).click()
    const deliveryNote = `E2E-LS-${suffix}`
    const payload = JSON.stringify({
      deliveryNoteNo: deliveryNote,
      supplier: 'E2E-Lieferant',
      orderNumber: `E2E-PO-${suffix}`,
      items: [{ supplierArticleNo: `E2E-IMP-${suffix}`, name: `Importteil ${suffix}`, quantity: 2, unit: 'Stk' }],
    })
    const jsonInput = page.getByPlaceholder(/JSON hier einfügen/)
    await jsonInput.fill(payload)
    await page.getByRole('button', { name: 'Feld prüfen' }).click()
    await page.getByRole('button', { name: /Geprüfte Positionen importieren/ }).click()
    await expect(page.getByText(/2 Teile zugebucht, 1 neu angelegt/)).toBeVisible()

    await page.getByRole('button', { name: 'Weiteren Import' }).click()
    await page.getByRole('button', { name: 'Manuellen Weg starten' }).click()
    await page.getByRole('button', { name: 'Ich habe schon JSON – weiter' }).click()
    await page.getByPlaceholder(/JSON hier einfügen/).fill(payload)
    await page.getByRole('button', { name: 'Feld prüfen' }).click()
    await page.getByRole('button', { name: /Geprüfte Positionen importieren/ }).click()
    await expect(page.getByRole('alert')).toContainText(`${deliveryNote} von E2E-Lieferant`)
    await page.getByRole('button', { name: 'Trotzdem erneut buchen' }).click()
    await expect(page.getByText(/2 Teile zugebucht, 0 neu angelegt/)).toBeVisible()
    await page.getByRole('button', { name: 'Schließen' }).click()

    await page.getByRole('button', { name: 'Benutzer', exact: true }).click()
    await expect(page.getByText(/Administrator \(Sie\).*letzter Admin/)).toBeVisible()
    await page.getByRole('button', { name: 'Neuen Benutzer hinzufügen' }).click()
    const newUserEmail = `techniker-${suffix}@example.invalid`
    await page.getByPlaceholder('benutzer@beispiel.de').fill(newUserEmail)
    await page.getByPlaceholder('z.B. Techniker 1').fill(`Techniker ${suffix}`)
    await page.locator('input[autocomplete="new-password"]').fill(`E2e-${suffix}-Pass!`)
    await page.getByRole('button', { name: 'Benutzer erstellen' }).click()
    await expect(page.getByText(newUserEmail)).toBeVisible()
    await page.getByRole('button', { name: `Passwort zurücksetzen für ${newUserEmail}` }).click()
    const resetInputs = page.locator('input[autocomplete="new-password"]')
    await resetInputs.nth(0).fill(`Reset-${suffix}-Pass!`)
    await resetInputs.nth(1).fill(`Reset-${suffix}-Pass!`)
    await page.getByRole('button', { name: 'Neues Passwort setzen' }).click()
    await page.getByRole('button', { name: 'Benutzerverwaltung schließen' }).click()
    await page.getByRole('button', { name: 'Profil', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Passwort ändern' })).toBeVisible()
  })

  test('QR-Scanner: Fehler, Fallback, Doppelklick und Neustart', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await login(page)
    await page.getByRole('button', { name: 'Einrichtung später fortsetzen' }).click()
    await page.getByRole('button', { name: 'QR-Scanner', exact: true }).click()
    const startButton = page.getByRole('button', { name: /Kamera starten/ })

    await installCameraFailure(page, 'NotAllowedError', 100)
    await startButton.evaluate((button) => {
      const start = button as HTMLButtonElement
      start.click()
      start.click()
    })
    await expect(page.getByText('Fehlername: notallowederror')).toBeVisible()
    expect(await page.evaluate(() => (window as typeof window & { __cameraCallCount?: number }).__cameraCallCount)).toBe(1)
    expect(consoleErrors.some((entry) => entry.includes('notallowederror'))).toBe(true)

    await page.getByRole('button', { name: 'Zurücksetzen' }).click()
    await expect(startButton).toBeEnabled()

    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __cameraCallCount?: number
        __cameraConstraints?: MediaStreamConstraints[]
      }
      testWindow.__cameraCallCount = 0
      testWindow.__cameraConstraints = []
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async (constraints: MediaStreamConstraints) => {
          testWindow.__cameraCallCount = (testWindow.__cameraCallCount ?? 0) + 1
          testWindow.__cameraConstraints?.push(constraints)
          const errorName = testWindow.__cameraCallCount === 1 ? 'OverconstrainedError' : 'NotFoundError'
          throw new DOMException('Synthetic camera selection failure', errorName)
        },
      })
    })
    await startButton.click()
    await expect(page.getByText('Fehlername: notfounderror')).toBeVisible()
    const fallbackResult = await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __cameraCallCount?: number
        __cameraConstraints?: MediaStreamConstraints[]
      }
      return {
        calls: testWindow.__cameraCallCount,
        constraints: testWindow.__cameraConstraints,
      }
    })
    expect(fallbackResult.calls).toBe(2)
    expect(fallbackResult.constraints?.[0]?.video).toMatchObject({ facingMode: { ideal: 'environment' } })
    expect(fallbackResult.constraints?.[1]?.video).toEqual({})

    await page.getByRole('button', { name: 'Zurücksetzen' }).click()
    await expect(startButton).toBeEnabled()
    await installCameraFailure(page, 'NotReadableError')
    await startButton.click()
    await expect(page.getByText('Fehlername: notreadableerror')).toBeVisible()
    await expect(page.getByText(/andere Apps oder Browser-Tabs/)).toBeVisible()

    await page.getByRole('button', { name: 'Zurücksetzen' }).click()
    await expect(startButton).toBeEnabled()
  })
})
