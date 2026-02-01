import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type StatKey = 'hp' | 'attack' | 'defense' | 'special-attack' | 'special-defense' | 'speed'

type Pokemon = {
  id: number
  name: string
  artwork: string
  stats: Record<StatKey, number>
  moves: string[]
  flavorText?: string
}

type Dataset = {
  generatedAt: string
  count: number
  pokemon: Pokemon[]
}

type PopularMoves = {
  generatedAt: string
  month: string
  sources: {
    smogon?: string
    vgc?: string
  }
  moves: {
    smogon: string[]
    vgc: string[]
    combined: string[]
  }
}

type Mode = 'menu' | 'stat' | 'move-compare' | 'move-truefalse' | 'dex-guess'

type GuessSide = 'left' | 'right'

type TrueFalse = 'true' | 'false'

type MovePool = 'popular' | 'smogon' | 'vgc' | 'all'

type Feedback = { text: string; tone: 'correct' | 'wrong' }

const STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP',
  attack: 'Attack',
  defense: 'Defense',
  'special-attack': 'Sp. Attack',
  'special-defense': 'Sp. Defense',
  speed: 'Speed',
}

const STAT_KEYS = Object.keys(STAT_LABELS) as StatKey[]
const HIGH_SCORE_KEYS = {
  stat: 'stat-guesser-high-score',
  compare: 'move-compare-high-score',
  truefalse: 'move-truefalse-high-score',
  dex: 'dex-guess-high-score',
}

function formatName(name: string) {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatMove(name: string) {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizeAnswer(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

function useHighScore(key: string) {
  const [highScore, setHighScore] = useState(0)

  useEffect(() => {
    const stored = localStorage.getItem(key)
    if (stored) {
      const parsed = Number(stored)
      if (!Number.isNaN(parsed)) {
        setHighScore(parsed)
      }
    }
  }, [key])

  useEffect(() => {
    if (highScore > 0) {
      localStorage.setItem(key, String(highScore))
    }
  }, [highScore, key])

  return [highScore, setHighScore] as const
}

async function fetchWithFallback<T>(path: string): Promise<T | null> {
  const base = import.meta.env.BASE_URL || '/'
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const runtimeBase = window.location.pathname.endsWith('/')
    ? window.location.pathname
    : window.location.pathname.replace(/\/[^/]*$/, '/')

  const candidates = [
    `${normalizedBase}${path}`,
    `${runtimeBase}${path}`,
    `/${path}`,
    path,
  ]

  for (const url of candidates) {
    try {
      const response = await fetch(url)
      if (!response.ok) continue
      return (await response.json()) as T
    } catch {
      // continue
    }
  }

  return null
}

function App() {
  const [mode, setMode] = useState<Mode>('menu')
  const [pokemon, setPokemon] = useState<Pokemon[]>([])
  const [popularMoves, setPopularMoves] = useState<PopularMoves | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'revealing' | 'result' | 'gameover'>('loading')
  const [left, setLeft] = useState<Pokemon | null>(null)
  const [right, setRight] = useState<Pokemon | null>(null)
  const [focus, setFocus] = useState<Pokemon | null>(null)
  const [stat, setStat] = useState<StatKey>('attack')
  const [moveName, setMoveName] = useState('')
  const [guess, setGuess] = useState<GuessSide | TrueFalse | null>(null)
  const [revealValues, setRevealValues] = useState({ left: 0, right: 0 })
  const [score, setScore] = useState(0)
  const [compareScore, setCompareScore] = useState(0)
  const [trueFalseScore, setTrueFalseScore] = useState(0)
  const [dexScore, setDexScore] = useState(0)
  const [dexGuess, setDexGuess] = useState('')
  const [dexAnswer, setDexAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lastKeptId, setLastKeptId] = useState<number | null>(null)
  const [movePool, setMovePool] = useState<MovePool>('popular')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const revealFrame = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const dexTimerRef = useRef<number | null>(null)

  const [statHighScore, setStatHighScore] = useHighScore(HIGH_SCORE_KEYS.stat)
  const [compareHighScore, setCompareHighScore] = useHighScore(HIGH_SCORE_KEYS.compare)
  const [trueFalseHighScore, setTrueFalseHighScore] = useHighScore(HIGH_SCORE_KEYS.truefalse)
  const [dexHighScore, setDexHighScore] = useHighScore(HIGH_SCORE_KEYS.dex)

  useEffect(() => {
    const load = async () => {
      try {
        const data = (await fetchWithFallback<Dataset>('data/pokemon.json')) ?? null
        if (!data) {
          throw new Error('Missing local Pokemon dataset. Run the fetch script to generate it.')
        }
        setPokemon(data.pokemon)
        setStatus('ready')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load Pokemon data.')
        setStatus('loading')
      }
    }
    void load()
  }, [])

  useEffect(() => {
    const loadPopularMoves = async () => {
      try {
        const data = await fetchWithFallback<PopularMoves>('data/popular-moves.json')
        if (data) setPopularMoves(data)
      } catch {
        setPopularMoves(null)
      }
    }
    void loadPopularMoves()
  }, [])

  useEffect(() => {
    if (!popularMoves) {
      setMovePool('all')
    }
  }, [popularMoves])

  useEffect(() => {
    return () => {
      if (dexTimerRef.current) {
        window.clearTimeout(dexTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (status === 'ready') {
      setFeedback(null)
    }
  }, [status])

  const totalPokemon = pokemon.length

  const currentLeftValue = left ? left.stats[stat] : 0
  const currentRightValue = right ? right.stats[stat] : 0

  const activeMovePool = useMemo(() => {
    if (!popularMoves || movePool === 'all') return null
    if (movePool === 'smogon') return popularMoves.moves.smogon
    if (movePool === 'vgc') return popularMoves.moves.vgc
    return popularMoves.moves.combined
  }, [popularMoves, movePool])

  const activeMoveSet = useMemo(() => {
    if (!activeMovePool) return null
    return new Set(activeMovePool)
  }, [activeMovePool])

  const initAudio = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume()
    }
  }, [])

  const playTone = useCallback((tone: 'correct' | 'wrong') => {
    const ctx = audioContextRef.current
    if (!ctx) return
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    const now = ctx.currentTime
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(tone === 'correct' ? 660 : 220, now)
    oscillator.frequency.exponentialRampToValueAtTime(tone === 'correct' ? 880 : 160, now + 0.18)

    gain.gain.setValueAtTime(0.001, now)
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)

    oscillator.connect(gain).connect(ctx.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.4)
  }, [])

  const isStatCorrect = useMemo(() => {
    if (!guess || !left || !right) return false
    if (currentLeftValue === currentRightValue) return false
    return guess === 'left' ? currentLeftValue > currentRightValue : currentRightValue > currentLeftValue
  }, [guess, left, right, currentLeftValue, currentRightValue])

  const isMoveCompareCorrect = useMemo(() => {
    if (!guess || !left || !right || !moveName) return false
    const leftHas = left.moves.includes(moveName)
    const rightHas = right.moves.includes(moveName)
    if (leftHas === rightHas) return false
    return guess === 'left' ? leftHas : rightHas
  }, [guess, left, right, moveName])

  const isTrueFalseCorrect = useMemo(() => {
    if (!guess || !focus || !moveName) return false
    const hasMove = focus.moves.includes(moveName)
    return guess === (hasMove ? 'true' : 'false')
  }, [guess, focus, moveName])

  const isDexCorrect = useMemo(() => {
    if (!dexAnswer) return false
    return normalizeAnswer(dexGuess) === normalizeAnswer(dexAnswer)
  }, [dexGuess, dexAnswer])

  const dexSuggestions = useMemo(() => {
    const query = normalizeAnswer(dexGuess)
    if (!query) return []
    return pokemon
      .filter((mon) => normalizeAnswer(mon.name).startsWith(query))
      .slice(0, 8)
      .map((mon) => mon.name)
  }, [dexGuess, pokemon])

  const pickRandomPokemon = useCallback(
    (excludeId?: number) => {
      if (pokemon.length === 0) return null
      let candidate = pokemon[Math.floor(Math.random() * pokemon.length)]
      let guard = 0
      while (excludeId && candidate.id === excludeId && guard < 40) {
        candidate = pokemon[Math.floor(Math.random() * pokemon.length)]
        guard += 1
      }
      return candidate
    },
    [pokemon],
  )

  const pickMoveFrom = useCallback((mon: Pokemon, moveSet: Set<string> | null) => {
    const pool = moveSet ? mon.moves.filter((move) => moveSet.has(move)) : mon.moves
    if (!pool.length) return ''
    return pool[Math.floor(Math.random() * pool.length)]
  }, [])

  const pickDexPokemon = useCallback(() => {
    if (pokemon.length === 0) return null
    let candidate = pokemon[Math.floor(Math.random() * pokemon.length)]
    let guard = 0
    while (!candidate?.flavorText && guard < 40) {
      candidate = pokemon[Math.floor(Math.random() * pokemon.length)]
      guard += 1
    }
    return candidate
  }, [pokemon])

  const startStatRound = useCallback(
    (keep?: Pokemon | null) => {
      if (pokemon.length < 2) return
      const nextLeft = keep ?? pickRandomPokemon()
      if (!nextLeft) return
      let nextRight = pickRandomPokemon(nextLeft.id)
      if (!nextRight) return
      let nextStat = STAT_KEYS[Math.floor(Math.random() * STAT_KEYS.length)]
      let guard = 0
      while (guard < 40 && nextRight && nextLeft.stats[nextStat] === nextRight.stats[nextStat]) {
        nextRight = pickRandomPokemon(nextLeft.id)
        nextStat = STAT_KEYS[Math.floor(Math.random() * STAT_KEYS.length)]
        guard += 1
      }

      setLeft(nextLeft)
      setRight(nextRight)
      setStat(nextStat)
      setGuess(null)
      setRevealValues({ left: 0, right: 0 })
    },
    [pickRandomPokemon, pokemon.length],
  )

  const startMoveCompareRound = useCallback(() => {
    if (pokemon.length < 2) return
    let attempts = 0
    while (attempts < 80) {
      const leftPick = pickRandomPokemon()
      if (!leftPick) return
      const movePick = pickMoveFrom(leftPick, activeMoveSet)
      if (!movePick) {
        attempts += 1
        continue
      }
      let rightPick = pickRandomPokemon(leftPick.id)
      let guard = 0
      while (rightPick && guard < 40 && rightPick.moves.includes(movePick)) {
        rightPick = pickRandomPokemon(leftPick.id)
        guard += 1
      }
      if (!rightPick) {
        attempts += 1
        continue
      }

      setLeft(leftPick)
      setRight(rightPick)
      setMoveName(movePick)
      setGuess(null)
      setRevealValues({ left: 0, right: 0 })
      return
    }
  }, [pickRandomPokemon, pickMoveFrom, pokemon.length, activeMoveSet])

  const startTrueFalseRound = useCallback(() => {
    if (pokemon.length === 0) return
    let attempts = 0
    while (attempts < 80) {
      const pick = pickRandomPokemon()
      if (!pick) return
      const movePick = pickMoveFrom(pick, activeMoveSet)
      if (!movePick) {
        attempts += 1
        continue
      }
      const isTrue = Math.random() > 0.5
      if (isTrue) {
        setFocus(pick)
        setMoveName(movePick)
      } else {
        const other = pickRandomPokemon(pick.id)
        if (!other) {
          attempts += 1
          continue
        }
        const falseMove = pickMoveFrom(other, activeMoveSet)
        if (!falseMove || pick.moves.includes(falseMove)) {
          attempts += 1
          continue
        }
        setFocus(pick)
        setMoveName(falseMove)
      }
      setGuess(null)
      return
    }
  }, [pickRandomPokemon, pickMoveFrom, pokemon.length, activeMoveSet])

  const startDexRound = useCallback(() => {
    const pick = pickDexPokemon()
    if (!pick) return
    setFocus(pick)
    setDexAnswer(pick.name)
    setDexGuess('')
    setGuess(null)
    setStatus('ready')
  }, [pickDexPokemon])

  useEffect(() => {
    if (status !== 'ready' || pokemon.length === 0) return
    if (mode === 'stat' && !left && !right) {
      startStatRound(null)
    }
    if (mode === 'move-compare' && !left && !right) {
      startMoveCompareRound()
    }
    if (mode === 'move-truefalse' && !focus) {
      startTrueFalseRound()
    }
    if (mode === 'dex-guess' && !focus) {
      startDexRound()
    }
  }, [
    status,
    pokemon.length,
    mode,
    left,
    right,
    focus,
    startStatRound,
    startMoveCompareRound,
    startTrueFalseRound,
    startDexRound,
  ])

  useEffect(() => {
    if (status !== 'revealing' || !left || !right || mode !== 'stat') return
    const duration = 1500
    const start = performance.now()
    const leftValue = left.stats[stat]
    const rightValue = right.stats[stat]

    const step = (time: number) => {
      const progress = Math.min((time - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setRevealValues({
        left: Math.round(leftValue * eased),
        right: Math.round(rightValue * eased),
      })
      if (progress < 1) {
        revealFrame.current = requestAnimationFrame(step)
      } else {
        setStatus('result')
      }
    }

    revealFrame.current = requestAnimationFrame(step)

    return () => {
      if (revealFrame.current) {
        cancelAnimationFrame(revealFrame.current)
      }
    }
  }, [status, left, right, stat, mode])

  useEffect(() => {
    if (status !== 'result') return
    const handle = window.setTimeout(() => {
      if (mode === 'stat') {
        if (left && right && guess && isStatCorrect) {
          setScore((prev) => prev + 1)
          const winner = guess === 'left' ? left : right
          const loser = guess === 'left' ? right : left
          const carry = winner.id === lastKeptId ? loser : winner
          setLastKeptId(carry.id)
          startStatRound(carry)
          setStatus('ready')
          return
        }
        if (!isStatCorrect) {
          setStatHighScore((prev) => Math.max(prev, score))
          setStatus('gameover')
          return
        }
      }

      if (mode === 'move-compare') {
        if (left && right && guess && isMoveCompareCorrect) {
          setCompareScore((prev) => prev + 1)
          startMoveCompareRound()
          setStatus('ready')
          return
        }
        if (!isMoveCompareCorrect) {
          setCompareHighScore((prev) => Math.max(prev, compareScore))
          setStatus('gameover')
          return
        }
      }

      if (mode === 'move-truefalse') {
        if (focus && guess && isTrueFalseCorrect) {
          setTrueFalseScore((prev) => prev + 1)
          startTrueFalseRound()
          setStatus('ready')
          return
        }
        if (!isTrueFalseCorrect) {
          setTrueFalseHighScore((prev) => Math.max(prev, trueFalseScore))
          setStatus('gameover')
        }
      }
    }, 1200)

    return () => window.clearTimeout(handle)
  }, [
    status,
    mode,
    left,
    right,
    focus,
    guess,
    isStatCorrect,
    isMoveCompareCorrect,
    isTrueFalseCorrect,
    score,
    compareScore,
    trueFalseScore,
    lastKeptId,
    startStatRound,
    startMoveCompareRound,
    startTrueFalseRound,
    setStatHighScore,
    setCompareHighScore,
    setTrueFalseHighScore,
  ])

  useEffect(() => {
    if (status === 'result') {
      if (mode === 'stat') {
        setFeedback({ text: isStatCorrect ? 'Correct!' : 'Wrong!', tone: isStatCorrect ? 'correct' : 'wrong' })
        playTone(isStatCorrect ? 'correct' : 'wrong')
      }
      if (mode === 'move-compare') {
        setFeedback({
          text: isMoveCompareCorrect ? 'Correct!' : 'Wrong!',
          tone: isMoveCompareCorrect ? 'correct' : 'wrong',
        })
        playTone(isMoveCompareCorrect ? 'correct' : 'wrong')
      }
      if (mode === 'move-truefalse') {
        setFeedback({
          text: isTrueFalseCorrect ? 'Correct!' : 'Wrong!',
          tone: isTrueFalseCorrect ? 'correct' : 'wrong',
        })
        playTone(isTrueFalseCorrect ? 'correct' : 'wrong')
      }
      if (mode === 'dex-guess') {
        setFeedback({ text: isDexCorrect ? 'Correct!' : 'Wrong!', tone: isDexCorrect ? 'correct' : 'wrong' })
        playTone(isDexCorrect ? 'correct' : 'wrong')
      }
    }
  }, [status, mode, isStatCorrect, isMoveCompareCorrect, isTrueFalseCorrect, isDexCorrect, playTone])

  useEffect(() => {
    if (status !== 'gameover') return
    setFeedback({ text: 'Game Over', tone: 'wrong' })
    playTone('wrong')
  }, [status, playTone])

  const handleGuess = (selection: GuessSide | TrueFalse) => {
    if (status !== 'ready') return
    initAudio()
    setGuess(selection)
    setStatus(mode === 'stat' ? 'revealing' : 'result')
  }

  const handleDexSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!dexAnswer || status !== 'ready') return
    initAudio()
    if (isDexCorrect) {
      setDexScore((prev) => prev + 1)
      setStatus('result')
      if (dexTimerRef.current) {
        window.clearTimeout(dexTimerRef.current)
      }
      dexTimerRef.current = window.setTimeout(() => {
        startDexRound()
        setStatus('ready')
      }, 1200)
    } else {
      setDexHighScore((prev) => Math.max(prev, dexScore))
      setStatus('gameover')
    }
  }

  const handleRestart = () => {
    setStatus('ready')
    setGuess(null)
    setRevealValues({ left: 0, right: 0 })
    setFeedback(null)
    if (dexTimerRef.current) {
      window.clearTimeout(dexTimerRef.current)
    }

    if (mode === 'stat') {
      setScore(0)
      setLastKeptId(null)
      startStatRound(null)
    }
    if (mode === 'move-compare') {
      setCompareScore(0)
      startMoveCompareRound()
    }
    if (mode === 'move-truefalse') {
      setTrueFalseScore(0)
      startTrueFalseRound()
    }
    if (mode === 'dex-guess') {
      setDexScore(0)
      startDexRound()
    }
  }

  const handleModeChange = (nextMode: Mode) => {
    setMode(nextMode)
    setStatus('ready')
    setGuess(null)
    setLeft(null)
    setRight(null)
    setFocus(null)
    setMoveName('')
    setRevealValues({ left: 0, right: 0 })
    setDexGuess('')
    setDexAnswer('')
    setFeedback(null)
    if (dexTimerRef.current) {
      window.clearTimeout(dexTimerRef.current)
    }
  }

  const statusMessage = useMemo(() => {
    if (status === 'gameover') return 'Wrong pick! Your streak is over.'
    if (status === 'result') {
      if (mode === 'stat') return isStatCorrect ? 'Nice! You got it.' : 'Oof, that was close.'
      if (mode === 'move-compare') return isMoveCompareCorrect ? 'Correct call!' : 'Nope, that move belongs elsewhere.'
      if (mode === 'move-truefalse') return isTrueFalseCorrect ? 'Right on!' : 'Not quite.'
    }
    if (mode === 'move-compare') return 'Which Pokemon learns this move?'
    if (mode === 'move-truefalse') return 'Does this Pokemon learn the move?'
    if (mode === 'dex-guess') return 'Type the Pokemon that matches the Pokedex entry.'
    return 'Pick the Pokemon with the higher stat.'
  }, [status, mode, isStatCorrect, isMoveCompareCorrect, isTrueFalseCorrect])

  const renderMovePoolControls = () => (
    <div className="filter-row">
      <span className="filter-label">Move pool</span>
      <div className="filter-group">
        <button
          className={`filter-button ${movePool === 'popular' ? 'active' : ''}`}
          onClick={() => setMovePool('popular')}
          disabled={!popularMoves}
        >
          Popular
        </button>
        <button
          className={`filter-button ${movePool === 'smogon' ? 'active' : ''}`}
          onClick={() => setMovePool('smogon')}
          disabled={!popularMoves}
        >
          Smogon OU
        </button>
        <button
          className={`filter-button ${movePool === 'vgc' ? 'active' : ''}`}
          onClick={() => setMovePool('vgc')}
          disabled={!popularMoves}
        >
          VGC
        </button>
        <button
          className={`filter-button ${movePool === 'all' ? 'active' : ''}`}
          onClick={() => setMovePool('all')}
        >
          All
        </button>
      </div>
      {popularMoves && <span className="filter-meta">Source: {popularMoves.month}</span>}
    </div>
  )

  const canPickCard = status === 'ready'

  if (error) {
    return (
      <div className="page">
        <header className="hero">
          <p className="eyebrow">Pokemon Minigames</p>
          <h1>Stat Guesser</h1>
          <p className="subtitle">Two Pokemon. One stat. Choose who has the higher base stat.</p>
        </header>
        <section className="arena">
          <div className="error-card">
            <h2>Data not found</h2>
            <p>{error}</p>
            <p className="hint">Run: <code>npm run fetch:pokemon</code></p>
          </div>
        </section>
      </div>
    )
  }

  if (mode === 'menu') {
    return (
      <div className="page">
        <header className="hero">
          <p className="eyebrow">Pokemon Minigames</p>
          <h1>Main Menu</h1>
          <p className="subtitle">Pick a mode to start a streak.</p>
        </header>

        <section className="menu-grid">
          <button className="menu-card" onClick={() => handleModeChange('stat')}>
            <span className="menu-title">Stat Guesser</span>
            <span className="menu-sub">Higher-or-lower with base stats.</span>
          </button>
          <button className="menu-card" onClick={() => handleModeChange('move-compare')}>
            <span className="menu-title">Move Match</span>
            <span className="menu-sub">Which Pokemon learns the move?</span>
          </button>
          <button className="menu-card" onClick={() => handleModeChange('move-truefalse')}>
            <span className="menu-title">Move True/False</span>
            <span className="menu-sub">Does this Pokemon learn this move?</span>
          </button>
          <button className="menu-card" onClick={() => handleModeChange('dex-guess')}>
            <span className="menu-title">Pokedex Guess</span>
            <span className="menu-sub">Name the Pokemon from its entry.</span>
          </button>
        </section>

        <footer className="footer">
          <p>Total Pokemon loaded: {totalPokemon}</p>
        </footer>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="hero">
        <button className="back-button" onClick={() => handleModeChange('menu')}>
          ← Back
        </button>
        <p className="eyebrow">Pokemon Minigames</p>
        <h1>
          {mode === 'stat' && 'Stat Guesser'}
          {mode === 'move-compare' && 'Move Match'}
          {mode === 'move-truefalse' && 'Move True/False'}
          {mode === 'dex-guess' && 'Pokedex Guess'}
        </h1>
        <p className="subtitle">{statusMessage}</p>
        {feedback && (
          <div className={`feedback ${feedback.tone === 'correct' ? 'good' : 'bad'}`}>{feedback.text}</div>
        )}
      </header>

      <section className="scoreboard">
        {mode === 'stat' && (
          <>
            <div className="score-card">
              <span className="score-label">Score</span>
              <span className="score-value">{score}</span>
            </div>
            <div className="score-card">
              <span className="score-label">High Score</span>
              <span className="score-value">{statHighScore}</span>
            </div>
            <div className="score-card stat-pill">
              <span className="score-label">Stat</span>
              <span className="score-value">{STAT_LABELS[stat]}</span>
            </div>
          </>
        )}
        {mode === 'move-compare' && (
          <>
            <div className="score-card">
              <span className="score-label">Score</span>
              <span className="score-value">{compareScore}</span>
            </div>
            <div className="score-card">
              <span className="score-label">High Score</span>
              <span className="score-value">{compareHighScore}</span>
            </div>
            <div className="score-card stat-pill">
              <span className="score-label">Move</span>
              <span className="score-value">{formatMove(moveName)}</span>
            </div>
          </>
        )}
        {mode === 'move-truefalse' && (
          <>
            <div className="score-card">
              <span className="score-label">Score</span>
              <span className="score-value">{trueFalseScore}</span>
            </div>
            <div className="score-card">
              <span className="score-label">High Score</span>
              <span className="score-value">{trueFalseHighScore}</span>
            </div>
            <div className="score-card stat-pill">
              <span className="score-label">Move</span>
              <span className="score-value">{formatMove(moveName)}</span>
            </div>
          </>
        )}
        {mode === 'dex-guess' && (
          <>
            <div className="score-card">
              <span className="score-label">Score</span>
              <span className="score-value">{dexScore}</span>
            </div>
            <div className="score-card">
              <span className="score-label">High Score</span>
              <span className="score-value">{dexHighScore}</span>
            </div>
          </>
        )}
      </section>

      {(mode === 'move-compare' || mode === 'move-truefalse') && renderMovePoolControls()}

      {mode === 'stat' && (
        <section className="arena">
          <article
            className={`poke-card ${guess === 'left' ? 'selected' : ''} ${canPickCard ? 'clickable' : ''}`}
            onClick={() => handleGuess('left')}
          >
            {left && (
              <>
                <img src={left.artwork} alt={left.name} loading="lazy" />
                <div className="poke-info">
                  <h3>{formatName(left.name)}</h3>
                  <p className="poke-id">#{left.id}</p>
                </div>
                <div className="stat-badge">
                  <span className="stat-label">{STAT_LABELS[stat]}</span>
                  <span className={`stat-value ${status !== 'ready' ? 'revealed' : ''}`}>
                    {status === 'ready' ? '???' : revealValues.left}
                  </span>
                </div>
              </>
            )}
          </article>

          <div className="versus">
            <span>VS</span>
            <div className="callout">{STAT_LABELS[stat]}</div>
            {status === 'gameover' && (
              <button className="guess-button restart" onClick={handleRestart}>
                Play again
              </button>
            )}
            <span className="meta">Total Pokemon loaded: {totalPokemon}</span>
          </div>

          <article
            className={`poke-card ${guess === 'right' ? 'selected' : ''} ${canPickCard ? 'clickable' : ''}`}
            onClick={() => handleGuess('right')}
          >
            {right && (
              <>
                <img src={right.artwork} alt={right.name} loading="lazy" />
                <div className="poke-info">
                  <h3>{formatName(right.name)}</h3>
                  <p className="poke-id">#{right.id}</p>
                </div>
                <div className="stat-badge">
                  <span className="stat-label">{STAT_LABELS[stat]}</span>
                  <span className={`stat-value ${status !== 'ready' ? 'revealed' : ''}`}>
                    {status === 'ready' ? '???' : revealValues.right}
                  </span>
                </div>
              </>
            )}
          </article>
        </section>
      )}

      {mode === 'move-compare' && (
        <section className="arena">
          <article
            className={`poke-card ${guess === 'left' ? 'selected' : ''} ${canPickCard ? 'clickable' : ''}`}
            onClick={() => handleGuess('left')}
          >
            {left && (
              <>
                <img src={left.artwork} alt={left.name} loading="lazy" />
                <div className="poke-info">
                  <h3>{formatName(left.name)}</h3>
                  <p className="poke-id">#{left.id}</p>
                </div>
              </>
            )}
          </article>

          <div className="versus">
            <span>VS</span>
            <div className="callout">{formatMove(moveName)}</div>
            {status === 'gameover' && (
              <button className="guess-button restart" onClick={handleRestart}>
                Play again
              </button>
            )}
            <span className="meta">Total Pokemon loaded: {totalPokemon}</span>
          </div>

          <article
            className={`poke-card ${guess === 'right' ? 'selected' : ''} ${canPickCard ? 'clickable' : ''}`}
            onClick={() => handleGuess('right')}
          >
            {right && (
              <>
                <img src={right.artwork} alt={right.name} loading="lazy" />
                <div className="poke-info">
                  <h3>{formatName(right.name)}</h3>
                  <p className="poke-id">#{right.id}</p>
                </div>
              </>
            )}
          </article>
        </section>
      )}

      {mode === 'move-truefalse' && (
        <section className="arena single">
          <article className="poke-card">
            {focus && (
              <>
                <img src={focus.artwork} alt={focus.name} loading="lazy" />
                <div className="poke-info">
                  <h3>{formatName(focus.name)}</h3>
                  <p className="poke-id">#{focus.id}</p>
                </div>
              </>
            )}
          </article>

          <div className="versus">
            <span>Does it learn?</span>
            <div className="callout">
              Does {focus ? formatName(focus.name) : 'this Pokemon'} learn {formatMove(moveName)}?
            </div>
            <button className="guess-button" onClick={() => handleGuess('true')} disabled={status !== 'ready'}>
              True
            </button>
            <button className="guess-button alt" onClick={() => handleGuess('false')} disabled={status !== 'ready'}>
              False
            </button>
            {status === 'gameover' && (
              <button className="guess-button restart" onClick={handleRestart}>
                Play again
              </button>
            )}
            <span className="meta">Total Pokemon loaded: {totalPokemon}</span>
          </div>
        </section>
      )}

      {mode === 'dex-guess' && (
        <section className="arena single">
          <article className="poke-card dex-card">
            <div className="dex-entry">{focus?.flavorText}</div>
          </article>
          <form className="dex-form" onSubmit={handleDexSubmit}>
            <label className="dex-label" htmlFor="dex-guess">
              Your guess
            </label>
            <div className="dex-row">
              <div className="dex-field">
                <input
                  id="dex-guess"
                  className="dex-input"
                  placeholder="Type a Pokemon name"
                  value={dexGuess}
                  onChange={(event) => setDexGuess(event.target.value)}
                  disabled={status !== 'ready'}
                  autoComplete="off"
                />
                {status === 'ready' && dexSuggestions.length > 0 && (
                  <div className="dex-suggestions">
                    {dexSuggestions.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="dex-suggestion"
                        onMouseDown={() => setDexGuess(formatName(name))}
                      >
                        {formatName(name)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className="guess-button" type="submit" disabled={status !== 'ready'}>
                Submit
              </button>
            </div>
            {status === 'gameover' && (
              <div className="dex-result">
                <p>Answer: {formatName(dexAnswer)}</p>
                <button className="guess-button restart" type="button" onClick={handleRestart}>
                  Play again
                </button>
              </div>
            )}
          </form>
        </section>
      )}

      <footer className="footer">
        <p>Correct picks keep your streak alive. Miss once and it resets.</p>
      </footer>
    </div>
  )
}

export default App
