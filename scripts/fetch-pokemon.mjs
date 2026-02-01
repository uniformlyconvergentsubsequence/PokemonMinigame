import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = join(__dirname, '..', 'public', 'data', 'pokemon.json')
const API_ROOT = 'https://pokeapi.co/api/v2/pokemon'

const STAT_KEYS = new Set([
  'hp',
  'attack',
  'defense',
  'special-attack',
  'special-defense',
  'speed',
])

const fetchJson = async (url) => {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed request: ${url}`)
  }
  return res.json()
}

const getArtwork = (data) =>
  data?.sprites?.other?.['official-artwork']?.front_default || data?.sprites?.front_default || ''

const normalizeText = (text = '') =>
  text
    .replace(/[\f\n\r\u000c]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const pickEnglishFlavor = (entries = []) => {
  const english = entries.filter((entry) => entry?.language?.name === 'en')
  if (english.length === 0) return ''
  const last = english[english.length - 1]
  return normalizeText(last.flavor_text)
}

const normalizePokemon = (data, flavorText) => {
  const stats = {
    hp: 0,
    attack: 0,
    defense: 0,
    'special-attack': 0,
    'special-defense': 0,
    speed: 0,
  }
  for (const entry of data.stats || []) {
    const key = entry?.stat?.name
    if (STAT_KEYS.has(key)) {
      stats[key] = entry.base_stat
    }
  }

  return {
    id: data.id,
    name: data.name,
    artwork: getArtwork(data),
    stats,
    moves: (data.moves || []).map((entry) => entry?.move?.name).filter(Boolean),
    flavorText,
  }
}

const fetchAllPokemon = async () => {
  const list = await fetchJson(`${API_ROOT}?limit=100000&offset=0`)
  const results = list.results || []
  const output = new Array(results.length)

  let cursor = 0
  const concurrency = 10

  const worker = async () => {
    while (cursor < results.length) {
      const index = cursor
      cursor += 1
      const item = results[index]
      if (!item?.url) continue
      const data = await fetchJson(item.url)
      const speciesUrl = data?.species?.url
      const species = speciesUrl ? await fetchJson(speciesUrl) : null
      const flavorText = pickEnglishFlavor(species?.flavor_text_entries)
      output[index] = normalizePokemon(data, flavorText)
      if (index % 50 === 0) {
        process.stdout.write('.')
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  return output.filter(Boolean)
}

const main = async () => {
  console.log('Fetching Pokemon data (this may take a while)...')
  const pokemon = await fetchAllPokemon()
  const payload = {
    generatedAt: new Date().toISOString(),
    count: pokemon.length,
    pokemon,
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8')
  console.log(`\nSaved ${pokemon.length} Pokemon to ${OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
