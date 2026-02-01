import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = join(__dirname, '..', 'public', 'data', 'popular-moves.json')
const STATS_ROOT = 'https://www.smogon.com/stats/'
const TOP_MOVES = 120

const fetchText = async (url) => {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed request: ${url}`)
  }
  return res.text()
}

const fetchJson = async (url) => {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed request: ${url}`)
  }
  return res.json()
}

const unique = (list) => [...new Set(list)]

const parseMonths = (html) => {
  const matches = [...html.matchAll(/href="(\d{4}-\d{2})\//g)].map((match) => match[1])
  return unique(matches).sort()
}

const parseFiles = (html) => {
  return [...html.matchAll(/href="([^"]+\.json)"/g)].map((match) => match[1])
}

const pickSmogonFormat = (files) => {
  const preferred = ['gen9ou-1695.json', 'gen9ou-1630.json', 'gen9ou-1500.json', 'gen9ou-0.json']
  for (const name of preferred) {
    if (files.includes(name)) return name
  }
  const fallback = files.find((file) => file.startsWith('gen9ou-') && file.endsWith('.json'))
  return fallback ?? null
}

const pickVgcFormat = (files) => {
  const patterns = [
    /gen9vgc.*bo3.*-1760\.json$/,
    /gen9vgc.*bo3.*-1630\.json$/,
    /gen9vgc.*bo3.*-1500\.json$/,
    /gen9vgc.*-1760\.json$/,
    /gen9vgc.*-1630\.json$/,
    /gen9vgc.*-1500\.json$/,
    /gen9vgc.*-0\.json$/,
  ]
  for (const pattern of patterns) {
    const match = files.find((file) => pattern.test(file))
    if (match) return match
  }
  return null
}

const computePopularMoves = (data) => {
  const scores = new Map()
  const entries = Object.values(data?.data ?? {})

  for (const entry of entries) {
    const usage = typeof entry?.usage === 'number' ? entry.usage : 0
    const moves = entry?.Moves ?? {}
    for (const [move, value] of Object.entries(moves)) {
      if (!move) continue
      const weight = usage * (typeof value === 'number' ? value / 100 : 0)
      scores.set(move, (scores.get(move) ?? 0) + weight)
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_MOVES)
    .map(([move]) => move)
}

const main = async () => {
  console.log('Fetching Smogon stats for popular moves...')
  const indexHtml = await fetchText(STATS_ROOT)
  const months = parseMonths(indexHtml)
  const latestMonth = months.at(-1)

  if (!latestMonth) {
    throw new Error('Unable to find latest stats month.')
  }

  const chaosUrl = `${STATS_ROOT}${latestMonth}/chaos/`
  const chaosHtml = await fetchText(chaosUrl)
  const files = parseFiles(chaosHtml)

  const smogonFile = pickSmogonFormat(files)
  const vgcFile = pickVgcFormat(files)

  if (!smogonFile) {
    throw new Error('Unable to find a Smogon OU chaos file.')
  }

  if (!vgcFile) {
    throw new Error('Unable to find a VGC chaos file.')
  }

  const smogonData = await fetchJson(`${chaosUrl}${smogonFile}`)
  const vgcData = await fetchJson(`${chaosUrl}${vgcFile}`)

  const smogonMoves = computePopularMoves(smogonData)
  const vgcMoves = computePopularMoves(vgcData)

  const combined = unique([...smogonMoves, ...vgcMoves])

  const payload = {
    generatedAt: new Date().toISOString(),
    month: latestMonth,
    sources: {
      smogon: smogonFile,
      vgc: vgcFile,
    },
    moves: {
      smogon: smogonMoves,
      vgc: vgcMoves,
      combined,
    },
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8')
  console.log(`Saved popular move list to ${OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
