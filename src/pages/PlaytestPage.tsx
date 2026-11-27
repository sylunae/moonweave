import { autoPlayCopy, playPauseCopy, redZoneCopy, settingsCopy, improvisationCopy as copy } from '@/config/app'
import { mergeRecording, recordingConflicts } from '@/features/chart/improvisation'
import { correctImprovisedNotes } from '@/features/chart/improvisationCorrection'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { preload } from 'react-dom'
import { ArrowLeft, Bot, Gauge, Pause, Play, RotateCcw, Settings, Sparkles } from 'lucide-react'
import { navigate } from '@/app/navigation'
import { useMobileBack } from '@/app/mobileBack'
import { useI18n } from '@/app/i18n'
import { usePreferences } from '@/app/preferences'
import { Button } from '@/components/ui/button'
import { PageLoader } from '@/components/PageLoader'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { compactTapSprite, defaultHoldSprite, defaultTapSprite, mobileHoldSprite, mobileTapSprite, ParticleSprite, redSprite, useParticleAppearance } from '@/features/appearance/ParticleSprite'
import { useChart } from '@/features/chart/ChartProvider'
import { usePlatform } from '@/features/platform/PlatformProvider'
import type { ChartNote } from '@/features/chart/types'
import { holdTickTimes } from '@/features/chart/tempoMap'
import { canPlayBackgroundVideo, syncBackgroundVideoTime as syncVideoTime } from '@/features/playtest/backgroundVideo'
import { BufferedPlaytestAudio, canBufferDuration } from '@/features/playtest/bufferedAudio'
import { PlaytestOpeningTrace } from '@/features/playtest/openingTrace'
import { createRedZoneIndex, RED_HOLD_GRACE_MS, RedZoneTracker } from '@/features/playtest/redZones'
import { PlaybackClock } from '@/features/playtest/PlaybackClock'
import { PlaytestRenderer, type PlaytestStats } from '@/features/playtest/PlaytestRenderer'
import { getPlaytestLaneCenterPercent, getPlaytestLanePositionPercent, getPlaytestViewportGeometry, JUDGMENT_LINE_Y, resolvePlaytestTrackLayout, TOUCH_LANE_START_Y } from '@/features/playtest/playtestGeometry'
import { accuracyFromUnits, judgmentUnits, scoreFromUnits, type Judgment } from '@/features/playtest/scoring'
import { usePlaytestViewport } from '@/features/playtest/usePlaytestViewport'

const INITIAL_STATS: PlaytestStats = { fps: 0, backend: 'WebGL2', renderScale: 1, notes: 0, drawCalls: 0, frameTimeP95: 0, frameTimeMax: 0, longFramePercent: 0, clockStalls: 0 }
const LANES = [0, 1, 2, 3] as const
const PREROLL_MS = 1000
const AUTO_TAP_HIGHLIGHT_MS = 85
type FeedbackResult = Judgment | 'Red'
type FeedbackSprite = 'tap' | 'red' | null
type FeedbackTiming = 'Early' | 'Late'
type AudioReadyState = 'buffered' | 'media' | 'error'
type PlaytestFeedback = {
  id: number
  lane: number
  result: FeedbackResult
  sprite: FeedbackSprite
  timing?: FeedbackTiming
}

export default function PlaytestPage({ onSettings, settingsOpen = false }: { onSettings?: () => void; settingsOpen?: boolean }) {
  const { text } = useI18n()
  const settingsLabel = text(settingsCopy.title.zh, settingsCopy.title.en)
  const editor = useChart()
  const platform = usePlatform()
  const improvising = editor.improvising && !platform.session
  const recordedRef = useRef<ChartNote[]>([])
  const correctedRef = useRef<ChartNote[] | null>(null)
  const committedRef = useRef(false)
  const [exitStep, setExitStep] = useState<'save' | 'conflict' | null>(null)
  const [saving, setSaving] = useState(false)
  const [recordingEnded, setRecordingEnded] = useState(false)
  const exitOpenRef = useRef(false)
  const formalSession = platform.session
  const formalAudioRef = useRef<HTMLAudioElement>(null)
  const chart = formalSession?.chart ?? editor.chart
  const audioUrl = formalSession?.audioUrl ?? editor.audioUrl
  const backgroundUrl = formalSession?.backgroundUrl ?? editor.backgroundUrl
  const audioRef = formalSession ? formalAudioRef : editor.audioRef
  const bufferedAudio = useMemo(() => new BufferedPlaytestAudio(), [audioUrl])
  const getAudio = useCallback(() => bufferedAudio.active ? bufferedAudio : audioRef.current, [audioRef, bufferedAudio])
  const openingTrace = useMemo(() => import.meta.env.DEV && new URLSearchParams(location.search).get('playtestTrace') === '1'
    ? new PlaytestOpeningTrace(getAudio)
    : null, [getAudio])
  const currentTime = formalSession ? 0 : editor.currentTime
  const runStartTimeRef = useRef(Math.max(0, Math.min(currentTime, chart.duration)))
  const restartCopy = runStartTimeRef.current > 0 ? playPauseCopy.restartFromEntry : playPauseCopy.restart
  const showToast = editor.showToast
  const { preferences } = usePreferences()
  const { portrait, mobileWeb, canChooseTrackMode } = usePlaytestViewport()
  const playbackRate = preferences.playbackRate
  const canBufferAudio = mobileWeb && typeof AudioContext !== 'undefined' && typeof OfflineAudioContext !== 'undefined'
  const [preparedAudio, setPreparedAudio] = useState<{ url: string; rate: number; status: AudioReadyState }>()
  const audioStatus = mobileWeb && audioUrl
    ? preparedAudio?.url === audioUrl && preparedAudio.rate === playbackRate ? preparedAudio.status : 'loading'
    : 'media'
  const canStart = audioStatus === 'buffered' || audioStatus === 'media'
  useEffect(() => {
    const audio = audioRef.current
    if (!mobileWeb || !audio || !audioUrl) return
    const controller = new AbortController()
    let decoding = false
    let settled = false
    let tryBuffer = canBufferAudio && playbackRate === 1
    const finish = (status: AudioReadyState) => {
      if (controller.signal.aborted || settled) return
      settled = true
      setPreparedAudio({ url: audioUrl, rate: playbackRate, status })
    }
    const check = () => {
      if (controller.signal.aborted || settled) return
      if (audio.error) { finish('error'); return }
      if (decoding || audio.readyState < HTMLMediaElement.HAVE_METADATA) return
      if (tryBuffer && canBufferDuration(audio.duration)) {
        decoding = true
        void bufferedAudio.prepare(audioUrl, audio.duration, controller.signal).then((ready) => {
          decoding = false
          if (ready) finish('buffered')
          else { tryBuffer = false; check() }
        })
      } else if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) finish('media')
    }
    const fail = () => finish('error')
    audio.addEventListener('loadedmetadata', check)
    audio.addEventListener('canplay', check)
    audio.addEventListener('error', fail)
    check()
    return () => {
      controller.abort()
      audio.removeEventListener('loadedmetadata', check)
      audio.removeEventListener('canplay', check)
      audio.removeEventListener('error', fail)
    }
  }, [audioRef, audioUrl, bufferedAudio, canBufferAudio, mobileWeb, playbackRate])
  useEffect(() => () => bufferedAudio.dispose(), [bufferedAudio])
  const spriteDpr = window.devicePixelRatio || 1
  // The largest tap and hold effects are about 352 and 272 CSS pixels.
  const tapSpriteSrc = mobileWeb ? mobileTapSprite : spriteDpr <= 1.45 ? compactTapSprite : defaultTapSprite
  const holdSpriteSrc = mobileWeb || spriteDpr <= 1.4 ? mobileHoldSprite : defaultHoldSprite
  const notes = useMemo(() => chart.notes.filter((note) => !note.disabled), [chart.notes])
  const notesHaveRed = useMemo(() => notes.some((note) => note.red), [notes])
  preload(tapSpriteSrc, { as: 'image' })
  preload(holdSpriteSrc, { as: 'image' })
  useEffect(() => {
    if (typeof Image.prototype.decode !== 'function') return
    const images = [tapSpriteSrc, holdSpriteSrc, ...(notesHaveRed ? [redSprite] : [])].map((src) => {
      const image = new Image()
      image.src = src
      void image.decode?.().catch(() => undefined)
      return image
    })
    return () => images.forEach((image) => { image.removeAttribute('src') })
  }, [tapSpriteSrc, holdSpriteSrc, notesHaveRed])
  const trackLayout = resolvePlaytestTrackLayout(portrait, canChooseTrackMode, preferences.trackMode)
  const laneTilt = trackLayout === 'tilted' ? Math.max(1, preferences.laneTilt) : 0
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const particleAppearance = useParticleAppearance(preferences.particleAppearanceId)
  const tapEffectDuration = particleAppearance?.tap.duration ?? 400
  const centeredJudgment = preferences.judgmentDisplay === 'center'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const progressRef = useRef<HTMLElement>(null)
  const backgroundVideoRef = useRef<HTMLVideoElement>(null)
  const rendererRef = useRef<PlaytestRenderer | null>(null)
  const redZones = useMemo(() => createRedZoneIndex(notes), [notes])
  const redDanger = useMemo(() => createRedZoneIndex(notes, -RED_HOLD_GRACE_MS), [notes])
  const holdProtection = useMemo(() => createRedZoneIndex(notes, RED_HOLD_GRACE_MS), [notes])
  const redTracker = useMemo(() => new RedZoneTracker(redDanger), [redDanger])
  const notesByTime = useMemo(() => notes.filter((note) => !note.red && !note.visualOnly).sort((a, b) => a.time - b.time), [notes])
  const fakeHeads = useMemo(() => new Set(notesByTime.filter((note) => redZones.contains(note.lane, note.time)).map((note) => note.id)), [notesByTime, redZones])
  const fakeNotes = useMemo(() => notesByTime.filter((note) => fakeHeads.has(note.id)), [fakeHeads, notesByTime])
  const notesByLane = useMemo(() => {
    const lanes: ChartNote[][] = [[], [], [], []]
    for (const note of notesByTime) if (!fakeHeads.has(note.id)) lanes[note.lane].push(note)
    return lanes
  }, [fakeHeads, notesByTime])
  const noteById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes])
  const hasCustomBackground = Boolean(backgroundUrl && chart.backgroundType)
  const hasVideoBackground = Boolean(backgroundUrl && chart.backgroundType === 'video')
  const duration = chart.duration
  const holdTicksById = useMemo(() => new Map(notesByTime.filter((note) => note.kind === 'hold' && note.endTime).map((note) => [note.id, holdTickTimes(chart, note.time, note.endTime!).filter((time) => !holdProtection.contains(note.lane, time))])), [chart, notesByTime, holdProtection])
  const totalTicks = useMemo(() => notesByTime.reduce((sum, note) => sum + (fakeHeads.has(note.id) ? 0 : 1) + (holdTicksById.get(note.id)?.length ?? 0), 0), [fakeHeads, holdTicksById, notesByTime])
  const windows = useMemo(() => preferences.timingWindow === 'strict' ? [55, 105, 145] : preferences.timingWindow === 'relaxed' ? [95, 180, 240] : [75, 140, 190], [preferences.timingWindow])

  const playingRef = useRef(false)
  const timeRef = useRef(currentTime)
  const autoTapUntilRef = useRef<number[]>([])
  const pressedRef = useRef(new Set<number>())
  const judgedRef = useRef(new Map<string, Judgment>())
  const holdStartsRef = useRef(new Map<string, { result: Judgment; hitTime?: number }>())
  const holdTicksRef = useRef(new Map<string, number>())
  const droppedHoldsRef = useRef(new Set<string>())
  const missCursorRef = useRef(0)
  const fakeCursorRef = useRef(0)
  const redContactRef = useRef(0)
  const scoringRef = useRef({ judgedTicks: 0, earnedUnits: 0, combo: 0 })
  const resultCountsRef = useRef<Record<Judgment, number>>({ Perfect: 0, Good: 0, Miss: 0 })
  const feedbackIdRef = useRef(0)
  const feedbackTimersRef = useRef(new Map<number, number>())
  const lastUiUpdateRef = useRef(0)
  const playbackClockRef = useRef(new PlaybackClock())
  const prerollTimeRef = useRef<number | null>(null)
  const prerollTargetRef = useRef(currentTime)
  const prerollFrameRef = useRef(0)
  const prerollEpochRef = useRef(0)
  const needsPrerollRef = useRef(true)

  const [autoSelected, setAutoSelected] = useState(false)
  const autoPlay = autoSelected && !formalSession && !improvising
  const [playing, setPlaying] = useState(false)
  const [pauseOpen, setPauseOpen] = useState(false)
  const pauseTriggerRef = useRef<HTMLButtonElement>(null)
  const [displayTime, setDisplayTime] = useState(currentTime)
  const videoActiveRef = useRef(currentTime >= chart.backgroundVideoStartTime)
  const [videoBackgroundActive, setVideoBackgroundActive] = useState(videoActiveRef.current)
  const [stats, setStats] = useState(INITIAL_STATS)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [accuracy, setAccuracy] = useState(100)
  const [pressed, setPressed] = useState(new Set<number>())
  const [holdSprites, setHoldSprites] = useState(new Map<number, 'active' | 'finishing'>())
  const [feedback, setFeedback] = useState<PlaytestFeedback[]>([])
  const [latestFeedbackId, setLatestFeedbackId] = useState(0)
  const [completed, setCompleted] = useState(false)

  useEffect(() => {
    document.body.classList.toggle('official-play', Boolean(formalSession))
    document.body.classList.toggle('improvisation-play', improvising)
    return () => document.body.classList.remove('official-play', 'improvisation-play')
  }, [formalSession, improvising])

  const getRenderTime = useCallback(() => {
    if (prerollTimeRef.current !== null) return prerollTimeRef.current
    const audio = getAudio()
    if (audio === bufferedAudio) return audio.currentTime * 1000
    return audio ? playbackClockRef.current.getTime(audio.currentTime * 1000) : timeRef.current
  }, [bufferedAudio, getAudio])

  const emitFeedback = useCallback((lane: number, result: FeedbackResult, sprite: FeedbackSprite, timing?: FeedbackTiming) => {
    openingTrace?.mark('feedback', { lane, result, sprite })
    const id = ++feedbackIdRef.current
    const previousTimer = feedbackTimersRef.current.get(lane)
    if (previousTimer) window.clearTimeout(previousTimer)
    setFeedback((items) => [...items.filter((item) => item.lane !== lane), { id, lane, result, sprite, timing }])
    setLatestFeedbackId(id)
    feedbackTimersRef.current.set(lane, window.setTimeout(() => {
      setFeedback((items) => items.filter((item) => item.id !== id))
      feedbackTimersRef.current.delete(lane)
    }, sprite === 'tap' ? Math.max(520, tapEffectDuration) : 520))
  }, [openingTrace, tapEffectDuration])

  const registerJudgment = useCallback((lane: number, result: Judgment, sprite: FeedbackSprite = null, timing?: FeedbackTiming) => {
    const state = scoringRef.current
    state.judgedTicks++
    state.earnedUnits += judgmentUnits(result)
    state.combo = result === 'Miss' ? 0 : state.combo + 1
    resultCountsRef.current[result] += 1
    setScore(scoreFromUnits(state.earnedUnits, totalTicks))
    setAccuracy(accuracyFromUnits(state.earnedUnits, state.judgedTicks))
    setCombo(state.combo)
    emitFeedback(lane, result, sprite, timing)
  }, [emitFeedback, totalTicks])

  const checkRedZones = useCallback((now: number) => {
    const hits = redTracker.advance(now, pressedRef.current)
    const fresh = hits & ~redContactRef.current
    redContactRef.current = hits
    if (!hits) return
    const hadCombo = scoringRef.current.combo > 0
    if (hadCombo) { scoringRef.current.combo = 0; setCombo(0) }
    if (fresh || hadCombo) for (let lane = 0; lane < 4; lane++) if (hits & (1 << lane)) emitFeedback(lane, 'Red', 'red')
  }, [emitFeedback, redTracker])

  const updateActiveHoldLanes = useCallback((finishedLane?: number) => {
    const lanes = new Set<number>()
    for (const [id, { result: startedAs }] of holdStartsRef.current) {
      const note = noteById.get(id)
      if (startedAs === 'Miss' && !holdTicksRef.current.get(id)) continue
      if (note && pressedRef.current.has(note.lane) && !droppedHoldsRef.current.has(id)) lanes.add(note.lane)
    }
    setHoldSprites((previous) => {
      const next = new Map(previous)
      for (const lane of lanes) next.set(lane, 'active')
      for (const [lane, state] of previous) {
        if (lanes.has(lane)) continue
        if (state === 'finishing' || lane === finishedLane) next.set(lane, 'finishing')
        else next.delete(lane)
      }
      return next.size === previous.size && [...next].every(([lane, state]) => previous.get(lane) === state) ? previous : next
    })
  }, [noteById])

  const finishHoldSprite = (lane: number) => {
    setHoldSprites((previous) => {
      if (previous.get(lane) !== 'finishing') return previous
      const next = new Map(previous)
      next.delete(lane)
      return next
    })
  }

  const syncAutoLanes = useCallback((mask: number) => {
    let changed = false
    for (let lane = 0; lane < 4; lane++) {
      const active = Boolean(mask & (1 << lane))
      if (pressedRef.current.has(lane) === active) continue
      if (active) pressedRef.current.add(lane)
      else pressedRef.current.delete(lane)
      rendererRef.current?.setLanePressed(lane, active)
      changed = true
    }
    if (changed) {
      setPressed(new Set(pressedRef.current))
      updateActiveHoldLanes()
    }
  }, [updateActiveHoldLanes])

  const releaseAutoLanes = useCallback(() => {
    if (!autoPlay) return
    autoTapUntilRef.current = []
    syncAutoLanes(0)
  }, [autoPlay, syncAutoLanes])

  const syncBackgroundVideoTime = useCallback((chartTime: number) => {
    const video = backgroundVideoRef.current
    if (video) syncVideoTime(video, chartTime, chart.backgroundVideoStartTime, getAudio()?.playbackRate ?? 1)
  }, [chart.backgroundVideoStartTime, getAudio])

  const syncBackgroundVideoPlayback = useCallback(() => {
    const video = backgroundVideoRef.current
    if (!video) return
    const audio = getAudio()
    const chartTime = audio ? audio.currentTime * 1000 : timeRef.current
    syncBackgroundVideoTime(chartTime)
    if (audio && playingRef.current && prerollTimeRef.current === null
      && canPlayBackgroundVideo(audio, chartTime, chart.backgroundVideoStartTime)) {
      if (video.paused) void video.play().catch(() => undefined)
    } else if (!video.paused) video.pause()
  }, [chart.backgroundVideoStartTime, getAudio, syncBackgroundVideoTime])

  const updateProgress = useCallback((time: number) => {
    const fraction = Math.max(0, Math.min(1, time / Math.max(1, duration)))
    if (progressRef.current) progressRef.current.style.transform = `scaleX(${fraction})`
    if (!hasVideoBackground) return
    const active = time >= chart.backgroundVideoStartTime
    if (active === videoActiveRef.current) return
    videoActiveRef.current = active
    setVideoBackgroundActive(active)
  }, [chart.backgroundVideoStartTime, duration, hasVideoBackground])

  const resetRun = useCallback((startTime: number) => {
    prerollEpochRef.current += 1; cancelAnimationFrame(prerollFrameRef.current)
    judgedRef.current.clear(); holdStartsRef.current.clear(); holdTicksRef.current.clear(); droppedHoldsRef.current.clear()
    redTracker.reset(startTime); redContactRef.current = 0; fakeCursorRef.current = 0
    while (fakeCursorRef.current < fakeNotes.length && fakeNotes[fakeCursorRef.current].time < startTime) fakeCursorRef.current++
    autoTapUntilRef.current = []
    pressedRef.current.clear(); missCursorRef.current = 0; scoringRef.current = { judgedTicks: 0, earnedUnits: 0, combo: 0 }; resultCountsRef.current = { Perfect: 0, Good: 0, Miss: 0 }
    feedbackTimersRef.current.forEach(window.clearTimeout); feedbackTimersRef.current.clear()
    setFeedback([]); setPressed(new Set()); setHoldSprites(new Map()); setScore(0); setAccuracy(100); setCombo(0); setCompleted(false)
    prerollTargetRef.current = startTime
    prerollTimeRef.current = startTime - PREROLL_MS
    needsPrerollRef.current = true
    rendererRef.current?.reset(startTime - PREROLL_MS)
    for (const note of notesByTime) {
      if (note.time >= startTime) break
      judgedRef.current.set(note.id, 'Miss')
      missCursorRef.current++
      scoringRef.current.judgedTicks += (fakeHeads.has(note.id) ? 0 : 1) + (holdTicksById.get(note.id)?.length ?? 0)
      rendererRef.current?.hideNote(note.id)
    }
    timeRef.current = startTime
    playbackClockRef.current.reset(startTime)
    setDisplayTime(startTime)
    updateProgress(startTime)
    const audio = getAudio()
    if (audio) { audio.pause(); audio.currentTime = startTime / 1000 }
    backgroundVideoRef.current?.pause()
    syncBackgroundVideoTime(startTime)
    playingRef.current = false; setPlaying(false)
  }, [fakeHeads, fakeNotes, getAudio, holdTicksById, notesByTime, redTracker, syncBackgroundVideoTime, updateProgress])

  const judgeHead = useCallback((note: ChartNote, result: Judgment, now: number, timing?: FeedbackTiming) => {
    if (note.animation && result !== 'Miss') rendererRef.current?.animateHit(note, now)
    openingTrace?.mark('note-head', { kind: note.kind, lane: note.lane, noteMs: note.time, result })
    if (note.kind === 'hold') {
      holdStartsRef.current.set(note.id, { result, hitTime: result === 'Miss' ? undefined : now }); holdTicksRef.current.set(note.id, 0); droppedHoldsRef.current.delete(note.id)
      rendererRef.current?.setHoldActive(note.id, true); updateActiveHoldLanes()
    } else { judgedRef.current.set(note.id, result); rendererRef.current?.hideNote(note.id) }
    registerJudgment(note.lane, result, note.kind !== 'hold' && result !== 'Miss' ? 'tap' : null, timing)
  }, [openingTrace, registerJudgment, updateActiveHoldLanes])

  const processFrame = useCallback((now: number) => {
    timeRef.current = now
    while (fakeCursorRef.current < fakeNotes.length && fakeNotes[fakeCursorRef.current].time <= now) {
      const note = fakeNotes[fakeCursorRef.current++]
      if (note.kind === 'hold' && (holdTicksById.get(note.id)?.length ?? 0) > 0) {
        holdStartsRef.current.set(note.id, { result: 'Perfect' }); holdTicksRef.current.set(note.id, 0)
        rendererRef.current?.setHoldStarted(note.id)
      } else judgedRef.current.set(note.id, 'Perfect')
      // Keep fake notes visible as they pass the line.
    }
    if (autoPlay) {
      while (missCursorRef.current < notesByTime.length && notesByTime[missCursorRef.current].time <= now) {
        const note = notesByTime[missCursorRef.current++]
        if (fakeHeads.has(note.id)) continue
        judgeHead(note, 'Perfect', note.time)
        if (note.kind !== 'hold') autoTapUntilRef.current[note.lane] = now + AUTO_TAP_HIGHLIGHT_MS
      }
    }
    let autoHoldMask = 0
    for (const [id, { result: startedAs }] of holdStartsRef.current) {
      const note = noteById.get(id)
      if (!note || judgedRef.current.has(id)) continue
      const endTime = note.endTime ?? note.time
      if (autoPlay && now < endTime) {
        const active = !redZones.contains(note.lane, now)
        rendererRef.current?.setHoldActive(id, active)
        if (active) autoHoldMask |= 1 << note.lane
      }
      const ticks = holdTicksById.get(id) ?? []
      const firstTickIndex = holdTicksRef.current.get(id) ?? 0
      let nextTickIndex = firstTickIndex
      while (nextTickIndex < ticks.length && ticks[nextTickIndex] <= now) {
        registerJudgment(note.lane, (autoPlay || (pressedRef.current.has(note.lane) && !droppedHoldsRef.current.has(id))) ? 'Perfect' : 'Miss')
        nextTickIndex += 1
      }
      holdTicksRef.current.set(id, nextTickIndex)
      if (startedAs === 'Miss' && firstTickIndex === 0 && nextTickIndex > 0) updateActiveHoldLanes()
      if (now >= endTime) {
        judgedRef.current.set(id, startedAs)
        holdStartsRef.current.delete(id); holdTicksRef.current.delete(id); droppedHoldsRef.current.delete(id)
        rendererRef.current?.setHoldActive(id, false); rendererRef.current?.hideNote(id)
        updateActiveHoldLanes(note.lane)
      }
    }
    if (autoPlay) {
      let pressedMask = autoHoldMask
      autoTapUntilRef.current.forEach((until, lane) => {
        if (now < until && !redZones.contains(lane, now)) pressedMask |= 1 << lane
      })
      syncAutoLanes(pressedMask)
      return
    }
    while (missCursorRef.current < notesByTime.length && now - notesByTime[missCursorRef.current].time > windows[2]) {
      const note = notesByTime[missCursorRef.current++]
      if (fakeHeads.has(note.id) || judgedRef.current.has(note.id) || holdStartsRef.current.has(note.id)) continue
      registerJudgment(note.lane, 'Miss', null, 'Late')
      if (note.kind === 'hold') {
        holdStartsRef.current.set(note.id, { result: 'Miss' })
        holdTicksRef.current.set(note.id, 0)
        droppedHoldsRef.current.add(note.id)
        rendererRef.current?.setHoldStarted(note.id)
      } else {
        judgedRef.current.set(note.id, 'Miss'); rendererRef.current?.hideNote(note.id)
      }
    }
    checkRedZones(now)
  }, [autoPlay, judgeHead, syncAutoLanes, redZones, checkRedZones, fakeHeads, fakeNotes, holdTicksById, noteById, notesByTime, registerJudgment, updateActiveHoldLanes, windows])

  const beforeDrawRef = useRef<(time: number, timestamp: number) => void>(() => {})
  useLayoutEffect(() => {
    beforeDrawRef.current = (time, timestamp) => {
      if (!playingRef.current || prerollTimeRef.current !== null || getAudio()?.paused !== false) return
      processFrame(time)
      if (timestamp - lastUiUpdateRef.current > 70) {
        updateProgress(time)
        syncBackgroundVideoPlayback()
        lastUiUpdateRef.current = timestamp
      }
    }
  }, [getAudio, processFrame, syncBackgroundVideoPlayback, updateProgress])

  useEffect(() => {
    const audio = audioRef.current
    const handleEnded = (event: Event) => {
      const endedAudio = getAudio()
      if (!endedAudio || event.currentTarget !== endedAudio) return
      const endedAt = endedAudio.currentTime * 1000
      processFrame(endedAt)
      releaseAutoLanes()
      playbackClockRef.current.stop(endedAt)
      timeRef.current = endedAt
      playingRef.current = false
      setPlaying(false)
      setDisplayTime(endedAt)
      updateProgress(endedAt)
      if (improvising) { setRecordingEnded(true); exitOpenRef.current = true; setExitStep('save') }
      else if (formalSession) setCompleted(true)
    }
    audio?.addEventListener('ended', handleEnded)
    bufferedAudio.addEventListener('ended', handleEnded)
    return () => {
      audio?.removeEventListener('ended', handleEnded)
      bufferedAudio.removeEventListener('ended', handleEnded)
    }
  }, [audioRef, bufferedAudio, formalSession, getAudio, improvising, processFrame, releaseAutoLanes, updateProgress])

  useEffect(() => {
    const video = backgroundVideoRef.current
    if (!video) return
    const audio = audioRef.current
    const events = ['playing', 'pause', 'waiting', 'seeking', 'seeked', 'ratechange', 'ended'] as const
    syncBackgroundVideoPlayback()
    document.addEventListener('visibilitychange', syncBackgroundVideoPlayback)
    video.addEventListener('loadedmetadata', syncBackgroundVideoPlayback)
    video.addEventListener('canplay', syncBackgroundVideoPlayback)
    video.addEventListener('seeked', syncBackgroundVideoPlayback)
    for (const event of events) {
      audio?.addEventListener(event, syncBackgroundVideoPlayback)
      bufferedAudio.addEventListener(event, syncBackgroundVideoPlayback)
    }
    return () => {
      document.removeEventListener('visibilitychange', syncBackgroundVideoPlayback)
      video.removeEventListener('loadedmetadata', syncBackgroundVideoPlayback)
      video.removeEventListener('canplay', syncBackgroundVideoPlayback)
      video.removeEventListener('seeked', syncBackgroundVideoPlayback)
      for (const event of events) {
        audio?.removeEventListener(event, syncBackgroundVideoPlayback)
        bufferedAudio.removeEventListener(event, syncBackgroundVideoPlayback)
      }
      video.pause()
    }
  }, [audioRef, backgroundUrl, bufferedAudio, syncBackgroundVideoPlayback])

  useEffect(() => {
    if (!openingTrace) return
    const canvas = canvasRef.current
    const audio = audioRef.current
    const video = backgroundVideoRef.current
    const viewport = window.visualViewport
    const markViewport = () => openingTrace.mark('viewport', {
      width: window.innerWidth, height: window.innerHeight,
      visualWidth: viewport?.width, visualHeight: viewport?.height,
      fullscreen: Boolean(document.fullscreenElement),
    })
    const markVisibility = () => openingTrace.mark('visibility', document.visibilityState)
    const markContext = (event: Event) => openingTrace.mark(event.type)
    const markMedia = (event: Event) => {
      const media = event.currentTarget as HTMLMediaElement
      openingTrace.mark(`${media.tagName.toLowerCase()}-${event.type}`, {
        timeMs: media.currentTime * 1000, readyState: media.readyState,
      })
    }
    const mediaEvents = ['playing', 'waiting', 'seeking', 'seeked', 'stalled', 'error']
    const media = [audio, video]
    for (const element of media) for (const event of mediaEvents) element?.addEventListener(event, markMedia)
    canvas?.addEventListener('webglcontextlost', markContext)
    canvas?.addEventListener('webglcontextrestored', markContext)
    viewport?.addEventListener('resize', markViewport)
    document.addEventListener('fullscreenchange', markViewport)
    document.addEventListener('visibilitychange', markVisibility)
    return () => {
      for (const element of media) for (const event of mediaEvents) element?.removeEventListener(event, markMedia)
      canvas?.removeEventListener('webglcontextlost', markContext)
      canvas?.removeEventListener('webglcontextrestored', markContext)
      viewport?.removeEventListener('resize', markViewport)
      document.removeEventListener('fullscreenchange', markViewport)
      document.removeEventListener('visibilitychange', markVisibility)
    }
  }, [audioRef, backgroundUrl, openingTrace])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new PlaytestRenderer({
      canvas, notes, laneTilt, trackLayout, scrollSpeed: preferences.noteScrollSpeed,
      bpm: chart.bpm, bpmChanges: chart.bpmChanges, effects: chart.effects, offset: chart.offset, duration: chart.duration, getTime: getRenderTime,
      getPlaying: () => playingRef.current,
      autoplay: false,
      getRecordedNotes: () => recordedRef.current,
      transparentBackground: hasCustomBackground,
      mobileWeb,
      initialRenderScale: mobileWeb ? 0.85 : hasVideoBackground ? 0.9 : 1,
      beforeDraw: (time, timestamp) => beforeDrawRef.current(time, timestamp),
      openingTrace,
      onStats: setStats,
      onViewportResize: (width, height) => setViewport((current) => current.width === width && current.height === height ? current : { width, height }),
    })
    for (const id of judgedRef.current.keys()) renderer.hideNote(id)
    for (const [id, { hitTime }] of holdStartsRef.current) {
      renderer.setHoldStarted(id)
      const note = noteById.get(id)
      if (note?.animation && hitTime !== undefined) renderer.animateHit(note, hitTime)
      if (note && pressedRef.current.has(note.lane) && !droppedHoldsRef.current.has(id)) renderer.setHoldActive(id, true)
    }
    for (const lane of pressedRef.current) renderer.setLanePressed(lane, true)
    rendererRef.current = renderer
    return () => { rendererRef.current = null; renderer.destroy() }
  }, [chart.bpm, chart.bpmChanges, chart.effects, chart.duration, chart.offset, getRenderTime, hasCustomBackground, hasVideoBackground, laneTilt, mobileWeb, noteById, notes, openingTrace, preferences.noteScrollSpeed, trackLayout])

  useEffect(() => {
    resetRun(runStartTimeRef.current)
    return () => { playingRef.current = false; prerollEpochRef.current += 1; cancelAnimationFrame(prerollFrameRef.current); getAudio()?.pause(); feedbackTimersRef.current.forEach(window.clearTimeout) }
  // This initializes a run when the playtest mounts; editor time changes are intentionally ignored afterward.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pausePlayback = useCallback(() => {
    if (needsPrerollRef.current) return
    if (prerollTimeRef.current !== null) { resetRun(prerollTargetRef.current); return }
    prerollEpochRef.current += 1
    const audio = getAudio()
    const pausedAt = audio ? audio.currentTime * 1000 : timeRef.current
    audio?.pause()
    releaseAutoLanes()
    playbackClockRef.current.stop(pausedAt)
    timeRef.current = pausedAt
    playingRef.current = false
    setPlaying(false)
    setDisplayTime(pausedAt)
    updateProgress(pausedAt)
    syncBackgroundVideoPlayback()
  }, [getAudio, releaseAutoLanes, resetRun, syncBackgroundVideoPlayback, updateProgress])

  const startPlayback = useCallback(async () => {
    if (exitOpenRef.current || settingsOpen || !canStart) return
    const audio = audioRef.current
    if (!audioUrl || !audio) { showToast(text('请先在编辑器的谱面信息中选择可用音频', 'Select usable audio in the editor’s Chart Info first')); return }
    if (playingRef.current) return
    const tryBuffered = audioStatus === 'buffered'
    if (tryBuffered) bufferedAudio.unlock()
    const playbackEpoch = needsPrerollRef.current ? prerollEpochRef.current + 1 : prerollEpochRef.current
    const outputReady = tryBuffered ? bufferedAudio.waitForOutput() : null
    let scheduled = false
    const startAudio = async () => {
      if (playbackEpoch !== prerollEpochRef.current || exitOpenRef.current) return
      try {
        const ready = scheduled || (outputReady && await outputReady)
        if (playbackEpoch !== prerollEpochRef.current || exitOpenRef.current) return
        const position = getAudio()?.currentTime ?? audio.currentTime
        openingTrace?.mark('play-requested', position * 1000)
        if (scheduled || (ready && bufferedAudio.playFrom(position))) {
          openingTrace?.mark('audio-clock', 'web-audio')
        } else {
          if (bufferedAudio.active) {
            bufferedAudio.pause()
            bufferedAudio.active = false
            audio.currentTime = position
          }
          audio.playbackRate = playbackRate
          openingTrace?.mark('audio-clock', 'media-element')
          await audio.play()
        }
        if (playbackEpoch !== prerollEpochRef.current || exitOpenRef.current) return
        const leavingPreroll = prerollTimeRef.current !== null
        const startedAudio = getAudio()
        if (!startedAudio) return
        openingTrace?.mark('play-resolved', startedAudio.currentTime * 1000)
        if (startedAudio !== bufferedAudio) playbackClockRef.current.start(audio.currentTime * 1000, performance.now(), audio.playbackRate, { waitForProgress: leavingPreroll })
        prerollTimeRef.current = null
        playingRef.current = true; setPlaying(true)
        syncBackgroundVideoPlayback()
      }
      catch {
        if (playbackEpoch !== prerollEpochRef.current || exitOpenRef.current) return
        playingRef.current = false; setPlaying(false); showToast(text('音频无法播放，请重新选择文件', 'Audio could not be played; select the file again'))
      }
    }
    if (!needsPrerollRef.current) {
      playingRef.current = true
      setPlaying(true)
      await startAudio()
      return
    }
    needsPrerollRef.current = false
    const targetTime = prerollTargetRef.current
    openingTrace?.start({
      startMs: targetTime,
      firstNoteMs: notes.find((note) => note.time >= targetTime)?.time ?? null,
      background: hasCustomBackground ? chart.backgroundType ?? null : null,
      trackDimming: preferences.trackBackgroundBlur,
    })
    const epoch = ++prerollEpochRef.current
    playingRef.current = true; setPlaying(true)
    if (outputReady && await outputReady) {
      if (epoch !== prerollEpochRef.current || !playingRef.current) return
      scheduled = bufferedAudio.playFrom(targetTime / 1000, PREROLL_MS / 1000)
      if (scheduled) openingTrace?.mark('audio-scheduled', targetTime)
    }
    if (epoch !== prerollEpochRef.current || !playingRef.current) return
    const startedAt = performance.now()
    const advancePreroll = (timestamp: number) => {
      if (epoch !== prerollEpochRef.current || !playingRef.current) return
      const time = scheduled ? bufferedAudio.timelineTime * 1000 : targetTime - PREROLL_MS + Math.max(0, timestamp - startedAt)
      prerollTimeRef.current = Math.max(prerollTimeRef.current ?? targetTime - PREROLL_MS, Math.min(targetTime, time))
      if (prerollTimeRef.current < targetTime) { prerollFrameRef.current = requestAnimationFrame(advancePreroll); return }
      void startAudio()
    }
    prerollFrameRef.current = requestAnimationFrame(advancePreroll)
  }, [audioRef, audioStatus, audioUrl, bufferedAudio, canStart, chart.backgroundType, getAudio, hasCustomBackground, notes, openingTrace, playbackRate, preferences.trackBackgroundBlur, settingsOpen, showToast, syncBackgroundVideoPlayback, text])

  const restart = useCallback(() => resetRun(runStartTimeRef.current), [resetRun])

  const hitLane = useCallback((lane: number, now: number) => {
    if (improvising && now >= 0 && now <= duration) {
      const tap: ChartNote = { id: crypto.randomUUID(), lane, time: now, kind: 'note' }
      recordedRef.current.push(tap)
    }
    if (redDanger.contains(lane, now)) return
    let reconnecting: ChartNote | undefined
    for (const id of holdStartsRef.current.keys()) {
      const note = noteById.get(id)
      if (note && note.lane === lane && !judgedRef.current.has(id) && now < (note.endTime ?? note.time) && droppedHoldsRef.current.has(id)) { reconnecting = note; break }
    }
    if (reconnecting) { droppedHoldsRef.current.delete(reconnecting.id); rendererRef.current?.setHoldActive(reconnecting.id, true); updateActiveHoldLanes(); return }
    const laneNotes = notesByLane[lane]
    let low = 0; let high = laneNotes.length
    while (low < high) { const middle = (low + high) >>> 1; if (laneNotes[middle].time < now - windows[2]) low = middle + 1; else high = middle }
    let candidate: ChartNote | undefined
    let closest = Infinity
    for (let index = low; index < laneNotes.length && laneNotes[index].time <= now + windows[2]; index++) {
      const note = laneNotes[index]
      if (judgedRef.current.has(note.id) || holdStartsRef.current.has(note.id)) continue
      const distance = Math.abs(note.time - now)
      if (distance < closest) { candidate = note; closest = distance }
    }
    if (!candidate) return
    const result: Judgment = closest <= windows[0] ? 'Perfect' : closest <= windows[1] ? 'Good' : 'Miss'
    const timing = result === 'Perfect' ? undefined : now < candidate.time ? 'Early' : 'Late'
    judgeHead(candidate, result, now, timing)
  }, [duration, getAudio, getRenderTime, improvising, noteById, notesByLane, redDanger, judgeHead, updateActiveHoldLanes, windows])

  const pressLane = useCallback((lane: number) => {
    if (autoPlay || pauseOpen || settingsOpen || pressedRef.current.has(lane)) return
    const judging = playingRef.current && !exitOpenRef.current && prerollTimeRef.current === null && !getAudio()?.paused
    const now = getRenderTime()
    openingTrace?.mark('lane-down', { lane, chartMs: now, judging })
    if (judging) processFrame(now) // Advance with the old key state before this transition.
    const next = new Set(pressedRef.current).add(lane)
    pressedRef.current = next; setPressed(next)
    rendererRef.current?.setLanePressed(lane, true)
    if (judging) hitLane(lane, now)
    updateActiveHoldLanes()
    if (judging) checkRedZones(now)
  }, [autoPlay, checkRedZones, getAudio, getRenderTime, hitLane, openingTrace, pauseOpen, processFrame, settingsOpen, updateActiveHoldLanes])

  const releaseLane = useCallback((lane: number) => {
    if (autoPlay || !pressedRef.current.has(lane)) return
    if (playingRef.current && !exitOpenRef.current && prerollTimeRef.current === null && !getAudio()?.paused) processFrame(getRenderTime())
    redContactRef.current &= ~(1 << lane)
    const next = new Set(pressedRef.current); next.delete(lane); pressedRef.current = next; setPressed(next); rendererRef.current?.setLanePressed(lane, false)
    let active: ChartNote | undefined
    for (const id of holdStartsRef.current.keys()) {
      const note = noteById.get(id)
      if (note && note.lane === lane && !judgedRef.current.has(id) && timeRef.current < (note.endTime ?? note.time)) { active = note; break }
    }
    if (active) { droppedHoldsRef.current.add(active.id); rendererRef.current?.setHoldActive(active.id, false) }
    updateActiveHoldLanes()
  }, [autoPlay, getAudio, getRenderTime, noteById, processFrame, updateActiveHoldLanes])

  const pressTouchLane = useCallback((event: React.PointerEvent<HTMLButtonElement>, lane: number) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pressLane(lane)
  }, [pressLane])

  const releaseTouchLane = useCallback((event: React.PointerEvent<HTMLButtonElement>, lane: number) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    releaseLane(lane)
  }, [releaseLane])

  const finishLeaving = useCallback(() => {
    getAudio()?.pause()
    if (formalSession) { platform.leavePlay(); navigate(formalSession.returnRoute) }
    else { editor.setImprovising(false); editor.setCurrentTime(timeRef.current); navigate('editor') }
  }, [editor, formalSession, getAudio, platform])

  const leave = useCallback(() => {
    if (!improvising || !recordedRef.current.length) { finishLeaving(); return }
    prerollEpochRef.current += 1
    cancelAnimationFrame(prerollFrameRef.current)
    const audio = getAudio()
    const now = audio ? audio.currentTime * 1000 : timeRef.current
    audio?.pause()
    playbackClockRef.current.stop(now)
    timeRef.current = now
    playingRef.current = false
    setPlaying(false)
    setDisplayTime(now)
    updateProgress(now)
    exitOpenRef.current = true
    setExitStep('save')
  }, [finishLeaving, getAudio, improvising, updateProgress])
  const openPause = useCallback(() => {
    if (pauseOpen || settingsOpen || exitOpenRef.current) return
    pausePlayback()
    for (const lane of pressedRef.current) releaseLane(lane)
    setPauseOpen(true)
  }, [pauseOpen, pausePlayback, releaseLane, settingsOpen])
  useMobileBack(true, openPause, false, true)

  const resume = () => {
    setPauseOpen(false)
    if (!completed) void startPlayback()
  }

  const restartFromPause = () => {
    if (improvising && recordedRef.current.length) return
    setPauseOpen(false)
    restart()
    void startPlayback()
  }

  const saveRecording = async (overwrite?: boolean) => {
    if (saving) return
    if (!recordedRef.current.length) { finishLeaving(); return }
    if (!committedRef.current && overwrite === undefined) correctedRef.current = correctImprovisedNotes(editor.chart, recordedRef.current)
    const recorded = correctedRef.current ?? recordedRef.current
    if (!committedRef.current && overwrite === undefined && recordingConflicts(editor.chart.notes, recorded).size) {
      setExitStep('conflict'); return
    }
    setSaving(true)
    try {
      if (!committedRef.current) {
        editor.commitEdit((current) => ({ ...current, notes: mergeRecording(current.notes, recorded, overwrite ?? false) }))
        committedRef.current = true
      }
      if (await editor.flushActiveChart()) finishLeaving()
      else showToast(text(copy.failed.zh, copy.failed.en))
    } catch { showToast(text(copy.failed.zh, copy.failed.en)) }
    finally { setSaving(false) }
  }

  useEffect(() => {
    const keyMap = new Map(preferences.playKeys.map((key, lane) => [key.toLowerCase(), lane]))
    const down = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || exitOpenRef.current || settingsOpen) return
      if (event.code === 'Escape' || event.code === 'Backspace' || event.key === 'BrowserBack' ||
          (event.altKey && event.code === 'ArrowLeft')) {
        event.preventDefault()
        openPause()
        return
      }
      if (pauseOpen || completed) return
      if (event.code === 'Space') {
        if (event.target instanceof HTMLElement && event.target.closest('button[aria-haspopup="dialog"]')) return
        event.preventDefault()
        if (playingRef.current) openPause()
        else void startPlayback()
        return
      }
      const lane = keyMap.get(event.key.toLowerCase()); if (lane !== undefined) { event.preventDefault(); pressLane(lane) }
    }
    const up = (event: KeyboardEvent) => { const lane = keyMap.get(event.key.toLowerCase()); if (lane !== undefined) releaseLane(lane) }
    const mouseBack = (event: MouseEvent) => {
      if (event.button !== 3 || settingsOpen || exitOpenRef.current) return
      event.preventDefault()
      openPause()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('auxclick', mouseBack)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('auxclick', mouseBack)
    }
  }, [completed, openPause, pauseOpen, preferences.playKeys, pressLane, releaseLane, settingsOpen, startPlayback])

  useEffect(() => {
    const releaseAll = () => { for (const lane of pressedRef.current) releaseLane(lane) }
    window.addEventListener('blur', releaseAll)
    return () => window.removeEventListener('blur', releaseAll)
  }, [releaseLane])

  const { halfWidth } = getPlaytestViewportGeometry(trackLayout, laneTilt, preferences.noteScrollSpeed, viewport.width, viewport.height)
  const laneEdge = (edge: number, y: number) => getPlaytestLanePositionPercent(edge, laneTilt, y, halfWidth)
  const laneX = (lane: number) => getPlaytestLaneCenterPercent(lane, laneTilt, halfWidth)
  const trackInset = laneEdge(0, JUDGMENT_LINE_Y)
  const trackTopInset = laneEdge(0, 0)
  const trackBottomInset = laneEdge(0, 1)
  const judgmentFeedback = centeredJudgment ? feedback.filter(({ id }) => id === latestFeedbackId) : feedback
  const judgments = judgmentFeedback.map((effect) => <div
    key={effect.id}
    className={`playtest-judgment ${centeredJudgment ? 'centered' : 'on-lane'}`}
    style={centeredJudgment ? undefined : { left: `${laneX(effect.lane)}%` }}
  >
    <div className={`playtest-judge-text ${effect.result.toLowerCase()}`}>
      {effect.result === 'Red' ? text(redZoneCopy.hit.zh, redZoneCopy.hit.en) : effect.result}
      {effect.timing && <small>{effect.timing}</small>}
    </div>
  </div>)

  return <div className="playtest-page page-enter" data-orientation={portrait ? 'portrait' : 'landscape'} style={{
    '--playtest-track-inset': `${trackInset}%`,
    '--playtest-effect-width': `${halfWidth * 60}%`,
    '--playtest-judgment-bottom': `${100 - JUDGMENT_LINE_Y * 100}%`,
    '--playtest-touch-height': `${(1 - TOUCH_LANE_START_Y) * 100}%`,
  } as React.CSSProperties}>
    {formalSession && <audio ref={formalAudioRef} src={audioUrl} preload="auto" />}
    {backgroundUrl && chart.backgroundType === 'image' && <img key={backgroundUrl} className="playtest-background" src={backgroundUrl} alt="" decoding="async" />}
    {backgroundUrl && chart.backgroundType === 'video' && <video key={backgroundUrl} ref={backgroundVideoRef} className="playtest-background" data-active={videoBackgroundActive} src={backgroundUrl} muted loop playsInline preload="metadata" disablePictureInPicture />}
    {preferences.trackBackgroundBlur && hasCustomBackground && (!hasVideoBackground || videoBackgroundActive) &&
      <div className="playtest-track-background-dimming" aria-hidden="true" style={{
        clipPath: `polygon(${trackTopInset}% 0, ${100 - trackTopInset}% 0, ${100 - trackBottomInset}% 100%, ${trackBottomInset}% 100%)`,
      }} />}
    <canvas ref={canvasRef} className="playtest-canvas" aria-label={text('WebGL2 谱面试玩画面', 'WebGL2 chart playtest')} />
    <div className="playtest-vignette" /><div className="playtest-judgment-line" />
    <header className="playtest-header">
      <Button ref={pauseTriggerRef} variant="outline" size="icon" aria-label={text(playPauseCopy.pause.zh, playPauseCopy.pause.en)} aria-haspopup="dialog" aria-expanded={pauseOpen && !settingsOpen && !exitStep} onClick={openPause}><Pause /></Button>
    </header>
    <aside className="playtest-score"><span>SCORE</span><strong>{score.toString().padStart(8, '0')}</strong><span>ACCURACY</span><strong>{accuracy.toFixed(2)}%</strong></aside>
    <aside className="playtest-performance"><div><Gauge /><span><b>{stats.fps || '—'} FPS · P95 {stats.frameTimeP95.toFixed(1)} MS</b><small>MAX {stats.frameTimeMax.toFixed(1)} MS · {Math.round(stats.renderScale * 100)}% SCALE</small></span></div><div><Sparkles /><span><b>{stats.notes} NOTES</b><small>{stats.longFramePercent.toFixed(1)}% LONG · {stats.clockStalls} CLOCK STALLS</small></span></div></aside>
    {LANES.map((lane) => {
      const effect = feedback.find((item) => item.lane === lane && item.sprite === 'tap')
      return <ParticleSprite key={lane} playbackId={effect?.id ?? null} hidden={!effect}
        className={effect && `playtest-hit-effect ${effect.result.toLowerCase()}`}
        style={{ left: `${laneX(lane)}%` }}
        defaultSrc={tapSpriteSrc} atlas={particleAppearance?.tap} transformFrames reduceMotion={preferences.reduceMotion}
      />
    })}
    {feedback.map((effect) => effect.sprite === 'red' && <ParticleSprite
      key={effect.id} className="playtest-hit-effect red" style={{ left: `${laneX(effect.lane)}%` }}
      defaultSrc={redSprite} reduceMotion={preferences.reduceMotion}
    />)}
    {!centeredJudgment && judgments}
    {LANES.map((lane) => {
      const state = holdSprites.get(lane)
      return <ParticleSprite key={lane} playbackId={state ? 1 : null} hidden={!state}
        className={state && (state === 'finishing' ? 'playtest-hold-effect finishing' : 'playtest-hold-effect')}
        style={{ left: `${laneX(lane)}%` }}
        defaultSrc={holdSpriteSrc} atlas={particleAppearance?.hold} loop transformFrames reduceMotion={preferences.reduceMotion}
        onAnimationEnd={state === 'finishing' ? () => finishHoldSprite(lane) : undefined}
      />
    })}
    <div className="playtest-hud">
      <div className="playtest-combo">{combo > 0 && <b>{combo}</b>}</div>
      {centeredJudgment && judgments}
    </div>
    {!playing && !pauseOpen && !completed && !exitStep && !settingsOpen && (
      <section className="playtest-ready" aria-label={chart.title}>
        <strong>{chart.title}</strong>
        {(chart.artist || chart.audioName) && <small>{chart.artist || chart.audioName}</small>}
        {audioStatus === 'loading' ? <PageLoader label={text(playPauseCopy.preparingAudio.zh, playPauseCopy.preparingAudio.en)} />
          : audioStatus === 'error' ? <p role="alert">{text(playPauseCopy.audioUnavailable.zh, playPauseCopy.audioUnavailable.en)}</p>
          : <Button onClick={() => void startPlayback()}>
          <Play fill="currentColor" />
          {displayTime > 0 ? text(playPauseCopy.resume.zh, playPauseCopy.resume.en) : formalSession ? text('开始游玩', 'Start play') : text('开始试玩', 'Start playtest')}
        </Button>}
      </section>
    )}
    <div className="playtest-key-caps">{preferences.playKeys.map((key, lane) => <button
      key={`${key}-${lane}`}
      data-sound="none"
      aria-label={text(`轨道 ${lane + 1}，按键 ${key}`, `Lane ${lane + 1}, key ${key}`)}
      className={pressed.has(lane) ? 'pressed' : ''}
      style={{
        '--lane-x': `${laneX(lane)}%`,
        '--lane-touch-clip': `polygon(${laneEdge(lane, TOUCH_LANE_START_Y)}% 0, ${laneEdge(lane + 1, TOUCH_LANE_START_Y)}% 0, ${laneEdge(lane + 1, 1)}% 100%, ${laneEdge(lane, 1)}% 100%)`,
      } as React.CSSProperties}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => pressTouchLane(event, lane)}
      onPointerUp={(event) => releaseTouchLane(event, lane)}
      onPointerCancel={(event) => releaseTouchLane(event, lane)}
      onLostPointerCapture={() => releaseLane(lane)}
    ><span>{key}</span></button>)}</div>
    <div className="playtest-progress"><i ref={progressRef} /></div>
    <Dialog open={pauseOpen && !settingsOpen && !exitStep} onMobileBack={openPause}>
      <DialogContent className="playtest-pause-menu" showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!pauseOpen && !completed) pauseTriggerRef.current?.focus({ preventScroll: true })
        }}>
        <DialogHeader><DialogTitle>{text(playPauseCopy.pause.zh, playPauseCopy.pause.en)}</DialogTitle><DialogDescription>{chart.title}</DialogDescription></DialogHeader>
        <div className="playtest-pause-actions" data-scroll-region>
          <Button disabled={!canStart} onClick={resume}><Play />{text(playPauseCopy.resume.zh, playPauseCopy.resume.en)}</Button>
          <Button variant="outline" disabled={!canStart || improvising && recordedRef.current.length > 0} onClick={restartFromPause}><RotateCcw />{text(restartCopy.zh, restartCopy.en)}</Button>
          {onSettings && <Button variant="outline" onClick={onSettings}><Settings />{settingsLabel}</Button>}
          {!formalSession && !improvising && <Button variant={autoPlay ? 'secondary' : 'outline'} aria-pressed={autoPlay} onClick={() => setAutoSelected(!autoPlay)}><Bot />{text(autoPlayCopy.zh, autoPlayCopy.en)}</Button>}
          {openingTrace && <Button variant="outline" onClick={() => openingTrace.download()}>{text(playPauseCopy.openingTrace.zh, playPauseCopy.openingTrace.en)}</Button>}
          <Button variant="outline" onClick={leave}><ArrowLeft />{formalSession ? text(playPauseCopy.leave.zh, playPauseCopy.leave.en) : text(playPauseCopy.backToEditor.zh, playPauseCopy.backToEditor.en)}</Button>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={exitStep !== null} onOpenChange={(open) => { if (!open && !saving && !committedRef.current && !recordingEnded) { exitOpenRef.current = false; setExitStep(null) } }}><DialogContent size="md" showCloseButton={!saving && !committedRef.current && !recordingEnded} onEscapeKeyDown={(event) => { if (saving || committedRef.current || recordingEnded) event.preventDefault() }} onInteractOutside={(event) => event.preventDefault()}>
      <DialogHeader><DialogTitle>{text((exitStep === 'conflict' ? copy.conflict : copy.save).zh, (exitStep === 'conflict' ? copy.conflict : copy.save).en)}</DialogTitle><DialogDescription>{text((exitStep === 'conflict' ? copy.conflictDescription : copy.description).zh, (exitStep === 'conflict' ? copy.conflictDescription : copy.description).en)} · {recordedRef.current.length} NOTES</DialogDescription></DialogHeader>
      <DialogFooter className="sm:flex-wrap">
        {!committedRef.current && !recordingEnded && <Button variant="outline" disabled={saving} onClick={() => { exitOpenRef.current = false; setExitStep(null) }}>{text(copy.cancel.zh, copy.cancel.en)}</Button>}
        {!committedRef.current && <Button variant="outline" disabled={saving} onClick={finishLeaving}>{text(copy.discard.zh, copy.discard.en)}</Button>}
        {exitStep === 'conflict' && !committedRef.current && <Button variant="outline" disabled={saving} onClick={() => void saveRecording(false)}>{text(copy.keep.zh, copy.keep.en)}</Button>}
        <Button disabled={saving} onClick={() => void saveRecording(exitStep === 'conflict' ? true : undefined)}>{text((exitStep === 'conflict' && !committedRef.current ? copy.overwrite : copy.confirm).zh, (exitStep === 'conflict' && !committedRef.current ? copy.overwrite : copy.confirm).en)}</Button>
      </DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={completed && !pauseOpen} onMobileBack={openPause}><DialogContent showCloseButton={false} className="result-dialog" onEscapeKeyDown={(event) => { event.preventDefault(); openPause() }}>
      <DialogHeader><span className="eyebrow">PLAY RESULT</span><DialogTitle>{text('演奏完成', 'Chart cleared')}</DialogTitle><DialogDescription>{chart.title} · {chart.artist}</DialogDescription></DialogHeader>
      <div className="result-grade">{accuracy >= 99 ? 'SS' : accuracy >= 95 ? 'S' : accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : 'C'}</div>
      <div className="result-score"><span>SCORE</span><strong>{score.toString().padStart(8, '0')}</strong><small>{accuracy.toFixed(2)}% ACCURACY</small></div>
      <div className="result-judgments"><div><span>PERFECT</span><b>{resultCountsRef.current.Perfect}</b></div><div><span>GOOD</span><b>{resultCountsRef.current.Good}</b></div><div><span>MISS</span><b>{resultCountsRef.current.Miss}</b></div><div><span>MAX COMBO</span><b>{combo}</b></div></div>
      <div className="result-actions"><Button onClick={restart}><RotateCcw />{text('再来一次', 'Retry')}</Button><Button variant="outline" onClick={leave}><ArrowLeft />{text('退出游玩', 'Leave play')}</Button></div>
    </DialogContent></Dialog>
  </div>
}
