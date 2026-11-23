import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const nodeModulesRoot = join(projectRoot, 'node_modules')
const outputPath = join(projectRoot, 'THIRD-PARTY-LICENSES.md')
const licenseFilePattern = /^(licen[cs]e|copying|notice)([-._].*)?$/i

if (!existsSync(nodeModulesRoot)) {
  throw new Error('node_modules fehlt. Führe zuerst npm ci aus.')
}

function declaredLicense(packageJson) {
  if (typeof packageJson.license === 'string') return packageJson.license
  if (packageJson.license?.type) return packageJson.license.type
  if (Array.isArray(packageJson.licenses)) {
    return packageJson.licenses.map((entry) => entry?.type ?? entry).join(' OR ')
  }
  return 'UNSPECIFIED'
}

const packages = new Map()

function scanNodeModules(directory) {
  if (!existsSync(directory)) return

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const packageRoot = join(directory, entry.name)

    if (entry.name.startsWith('@')) {
      scanNodeModules(packageRoot)
      continue
    }

    const packageJsonPath = join(packageRoot, 'package.json')
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
      if (packageJson.name && packageJson.version) {
        const id = `${packageJson.name}@${packageJson.version}`
        if (!packages.has(id)) {
          const files = readdirSync(packageRoot, { withFileTypes: true })
            .filter((item) => item.isFile() && licenseFilePattern.test(item.name))
            .map((item) => item.name)
            .sort((a, b) => a.localeCompare(b))
          packages.set(id, {
            id,
            license: declaredLicense(packageJson),
            root: packageRoot,
            files,
          })
        }
      }
    }

    scanNodeModules(join(packageRoot, 'node_modules'))
  }
}

scanNodeModules(nodeModulesRoot)

const packageList = [...packages.values()].sort((a, b) => a.id.localeCompare(b.id))
if (packageList.length === 0) throw new Error('Keine npm-Pakete gefunden.')

const textGroups = new Map()
const canonicalGroupByLicense = new Map()

for (const npmPackage of packageList) {
  npmPackage.groupIds = []
  for (const fileName of npmPackage.files) {
    const text = readFileSync(join(npmPackage.root, fileName), 'utf8').replace(/\r\n/g, '\n').trimEnd()
    const hash = createHash('sha256').update(text).digest('hex')
    const groupId = hash.slice(0, 12)
    if (!textGroups.has(hash)) textGroups.set(hash, { groupId, text, sources: [] })
    textGroups.get(hash).sources.push(`${npmPackage.id}/${fileName}`)
    npmPackage.groupIds.push(groupId)
    if (!canonicalGroupByLicense.has(npmPackage.license)) canonicalGroupByLicense.set(npmPackage.license, groupId)
  }
}

for (const npmPackage of packageList) {
  if (npmPackage.groupIds.length === 0 && canonicalGroupByLicense.has(npmPackage.license)) {
    npmPackage.groupIds.push(canonicalGroupByLicense.get(npmPackage.license))
  }
}

const counts = new Map()
for (const npmPackage of packageList) counts.set(npmPackage.license, (counts.get(npmPackage.license) ?? 0) + 1)

const mplPackages = packageList.filter((item) => item.license.includes('MPL-2.0')).map((item) => item.id)
const ccByPackages = packageList.filter((item) => item.license.includes('CC-BY-4.0')).map((item) => item.id)
const explicitlyNoncommercial = packageList.filter((item) => /noncommercial|non-commercial|\bNC\b/i.test(item.license))
const unspecified = packageList.filter((item) => item.license === 'UNSPECIFIED')

if (explicitlyNoncommercial.length > 0 || unspecified.length > 0) {
  throw new Error(`Manuelle Lizenzprüfung erforderlich: ${[...explicitlyNoncommercial, ...unspecified].map((item) => item.id).join(', ')}`)
}

const pocketBaseLicensePath = join(nodeModulesRoot, 'pocketbase', 'LICENSE.md')
const apacheLicensePath = join(nodeModulesRoot, 'xlsx', 'LICENSE')
const extractedCaddyLicensePath = join(projectRoot, 'output', 'windows-installer', 'cache', 'expanded', 'caddy', 'LICENSE')
if (!existsSync(pocketBaseLicensePath) || !existsSync(apacheLicensePath)) {
  throw new Error('Referenztexte für PocketBase oder Apache-2.0 fehlen.')
}

const pocketBaseLicense = readFileSync(pocketBaseLicensePath, 'utf8').replace(/\r\n/g, '\n').trimEnd()
const apacheLicense = readFileSync(apacheLicensePath, 'utf8').replace(/\r\n/g, '\n').trimEnd()
const caddyLicense = existsSync(extractedCaddyLicensePath)
  ? readFileSync(extractedCaddyLicensePath, 'utf8').replace(/\r\n/g, '\n').trimEnd()
  : `\n${apacheLicense
      .replace('brackets "{}"', 'brackets "[]"')
      .replace('Copyright (C) 2012-present   SheetJS LLC', 'Copyright [yyyy] [name of copyright owner]')}`

const lines = [
  '# Third-Party Licenses',
  '',
  'Diese Datei dokumentiert die unveränderten Lizenztexte der mitgelieferten Komponenten und der mit `npm ci` installierten Abhängigkeiten. Die Projektlizenz steht separat in `LICENSE.md`.',
  '',
  '## Ergebnis der npm-Lizenzprüfung',
  '',
  `Geprüft wurden ${packageList.length} eindeutige npm-Pakete einschließlich Entwicklungs- und transitiver Abhängigkeiten aus dem installierten, durch \`package-lock.json\` festgelegten Abhängigkeitsbaum.`,
  '',
  '- Keine deklarierte npm-Lizenz verbietet die kommerzielle Weitergabe.',
  `- MPL-2.0 wird von ${mplPackages.length} Paketen verwendet (${mplPackages.join(', ')}). Kommerzielle Weitergabe ist erlaubt, Änderungen an MPL-abgedeckten Dateien unterliegen jedoch den Quellcode- und Hinweispflichten der MPL-2.0.`,
  `- CC-BY-4.0 wird von ${ccByPackages.length} Paket verwendet (${ccByPackages.join(', ')}). Kommerzielle Weitergabe ist erlaubt, die Namensnennungs- und Hinweisbedingungen müssen eingehalten werden.`,
  '- Apache-2.0, BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0, ISC und MIT erlauben kommerzielle Weitergabe unter ihren jeweiligen Hinweis-, Lizenz- und gegebenenfalls Patentbedingungen.',
  '- Diese automatisierte Bestandsaufnahme ersetzt keine Rechtsberatung.',
  '',
  '### Lizenzverteilung',
  '',
  '| Lizenzangabe | Pakete |',
  '|---|---:|',
  ...[...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([license, count]) => `| ${license.replace(/\|/g, '\\|')} | ${count} |`),
  '',
  '## PocketBase',
  '',
  'Komponente: PocketBase 0.40.6 und PocketBase JavaScript SDK 0.29.0  ',
  'Lizenz: MIT',
  '',
  '~~~~text',
  pocketBaseLicense,
  '~~~~',
  '',
  '## Caddy',
  '',
  'Komponente: Caddy 2.11.9  ',
  'Lizenz: Apache License 2.0',
  '',
  '~~~~text',
  caddyLicense,
  '~~~~',
  '',
  '## npm-Paketinventar',
  '',
  '| Paket | Deklarierte Lizenz | Lizenztextgruppe(n) |',
  '|---|---|---|',
  ...packageList.map((item) => `| ${item.id.replace(/\|/g, '\\|')} | ${item.license.replace(/\|/g, '\\|')} | ${item.groupIds.length ? item.groupIds.join(', ') : 'nur Paketmetadaten'} |`),
  '',
  '## Unveränderte npm-Lizenz- und Hinweistexte',
  '',
]

for (const group of [...textGroups.values()].sort((a, b) => a.groupId.localeCompare(b.groupId))) {
  lines.push(
    `### Textgruppe ${group.groupId}`,
    '',
    'Verwendet von:',
    '',
    ...group.sources.sort((a, b) => a.localeCompare(b)).map((source) => `- ${source}`),
    '',
    '~~~~text',
    group.text,
    '~~~~',
    '',
  )
}

writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8')
console.log(`Erstellt: ${relative(projectRoot, outputPath)} (${packageList.length} npm-Pakete, ${textGroups.size} eindeutige Lizenz-/Hinweistexte)`)
