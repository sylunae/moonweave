import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Gauge, Pause, Play, RotateCcw, Sparkles } from 'lucide-react'
import { navigate } from '@/app/navigation'
import { useI18n } from '@/app/i18n'
import { usePreferences } from '@/app/preferences'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useChart } from '@/features/chart/ChartProvider'
import { usePlatform } from '@/features/platform/PlatformProvider'
import type { ChartNote } from '@/features/chart/types'
import { holdTickTimes } from '@/features/chart/tempoMap'
import { PlaybackClock } from '@/features/playtest/PlaybackClock'
import { PlaytestRenderer, type PlaytestStats } from '@/features/playtest/PlaytestRenderer'
import { getPlaytestLaneCenterPercent, getPlaytestTrackHalfWidth } from '@/features/playtest/playtestGeometry'
import { accuracyFromUnits, judgmentUnits, scoreFromUnits, type Judgment } from '@/features/playtest/scoring'

const INITIAL_STATS: PlaytestStats = { fps: 0, backend: 'WebGL2', renderScale: 1, notes: 0, particles: 0, drawCalls: 0, frameTimeP95: 0, frameTimeMax: 0, longFramePercent: 0, clockStalls: 0 }
const PREROLL_MS = 1000
const effectTexture = (lane: number, result: Judgment = 'Perfect') => `${import.meta.env.BASE_URL}assets/particle/${result === 'Miss' ? 'challenge_white' : lane === 0 || lane === 3 ? 'note_mirai_light' : 'note_light'}.png`

export default function PlaytestPage() {
  const { text } = useI18n()
  const editor = useChart()
  const platform = usePlatform()
  const formalSession = platform.session
  const formalAudioRef = useRef<HTMLAudioElement>(null)
  const chart = formalSession?.chart ?? editor.chart
  const audioUrl = formalSession?.audioUrl ?? editor.audioUrl
  const backgroundUrl = formalSession?.backgroundUrl ?? editor.backgroundUrl
  const audioRef = formalSession ? formalAudioRef : editor.audioRef
  const currentTime = formalSession ? 0 : editor.currentTime
  const showToast = editor.showToast
  const { preferences } = usePreferences()
  const playbackRate = preferences.playbackRate
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const backgroundVideoRef = useRef<HTMLVideoElement>(null)
  const rendererRef = useRef<PlaytestRenderer | null>(null)
  const notes = chart.notes
  const notesByTime = useMemo(() => [...notes].sort((a, b) => a.time - b.time), [notes])
  const notesByLane = useMemo(() => [0, 1, 2, 3].map((lane) => notes.filter((note) => note.lane === lane).sort((a, b) => a.time - b.time)), [notes])
  const noteById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes])
  const hasCustomBackground = Boolean(backgroundUrl && chart.backgroundType)
  const hasVideoBackground = Boolean(backgroundUrl && chart.backgroundType === 'video')
  const duration = chart.duration
  const holdTicksById = useMemo(() => new Map(notes.filter((note) => note.kind === 'hold' && note.endTime).map((note) => [note.id, holdTickTimes(chart, note.time, note.endTime!)])), [chart, notes])
  const totalTicks = useMemo(() => notes.reduce((sum, note) => sum + 1 + (holdTicksById.get(note.id)?.length ?? 0), 0), [holdTicksById, notes])
  const windows = useMemo(() => preferences.timingWindow === 'strict' ? [55, 105, 145] : preferences.timingWindow === 'relaxed' ? [95, 180, 240] : [75, 140, 190], [preferences.timingWindow])

  const playingRef = useRef(false)
  const timeRef = useRef(currentTime)
  const pressedRef = useRef(new Set<number>())
  const judgedRef = useRef(new Map<string, Judgment>())
  const holdStartsRef = useRef(new Map<string, Judgment>())
  const holdTicksRef = useRef(new Map<string, number>())
  const droppedHoldsRef = useRef(new Set<string>())
  const missCursorRef = useRef(0)
  const scoringRef = useRef({ judgedTicks: 0, earnedUnits: 0, combo: 0 })
  const resultCountsRef = useRef<Record<Judgment, number>>({ Perfect: 0, Good: 0, Miss: 0 })
  const feedbackIdRef = useRef(0)
  const feedbackTimersRef = useRef(new Map<number, number>())
  const rafRef = useRef(0)
  const lastUiUpdateRef = useRef(0)
  const playbackClockRef = useRef(new PlaybackClock())
  const prerollTimeRef = useRef<number | null>(null)
  const prerollTargetRef = useRef(currentTime)
  const prerollFrameRef = useRef(0)
  const prerollEpochRef = useRef(0)
  const needsPrerollRef = useRef(true)

  const [playing, setPlaying] = useState(false)
  const [displayTime, setDisplayTime] = useState(currentTime)
  const [stats, setStats] = useState(INITIAL_STATS)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [accuracy, setAccuracy] = useState(100)
  const [pressed, setPressed] = useState(new Set<number>())
  const [activeHoldLanes, setActiveHoldLanes] = useState(new Set<number>())
  const [feedback, setFeedback] = useState<Array<{ id: number; lane: number; result: Judgment }>>([])
  const [completed, setCompleted] = useState(false)

  useEffect(() => {
    document.body.classList.toggle('official-play', Boolean(formalSession))
    return () => document.body.classList.remove('official-play')
  }, [formalSession])

  const getRenderTime = useCallback(() => {
    if (prerollTimeRef.current !== null) return prerollTimeRef.current
    const audio = audioRef.current
    return audio ? playbackClockRef.current.getTime(audio.currentTime * 1000) : timeRef.current
  }, [audioRef])

  const emitFeedback = useCallback((lane: number, result: Judgment) => {
    const id = ++feedbackIdRef.current
    const previousTimer = feedbackTimersRef.current.get(lane)
    if (previousTimer) window.clearTimeout(previousTimer)
    setFeedback((items) => [...items.filter((item) => item.lane !== lane), { id, lane, result }])
    feedbackTimersRef.current.set(lane, window.setTimeout(() => {
      setFeedback((items) => items.filter((item) => item.id !== id))
      feedbackTimersRef.current.delete(lane)
    }, 520))
  }, [])

  const registerJudgment = useCallback((lane: number, result: Judgment) => {
    const state = scoringRef.current
    state.judgedTicks++
    state.earnedUnits += judgmentUnits(result)
    state.combo = result === 'Miss' ? 0 : state.combo + 1
    resultCountsRef.current[result] += 1
    setScore(scoreFromUnits(state.earnedUnits, totalTicks))
    setAccuracy(accuracyFromUnits(state.earnedUnits, state.judgedTicks))
    setCombo(state.combo)
    rendererRef.current?.triggerHit(lane, timeRef.current, result === 'Perfect' ? 1 : result === 'Good' ? 0.72 : 0.4)
    emitFeedback(lane, result)
  }, [emitFeedback, totalTicks])

  const updateActiveHoldLanes = useCallback(() => {
    const lanes = new Set<number>()
    for (const id of holdStartsRef.current.keys()) {
      const note = noteById.get(id)
      if (note && pressedRef.current.has(note.lane) && !droppedHoldsRef.current.has(id)) lanes.add(note.lane)
    }
    setActiveHoldLanes(lanes)
  }, [noteById])

  const syncBackgroundVideoTime = useCallback((chartTime: number) => {
    const video = backgroundVideoRef.current
    if (!video) return
    const requestedTime = Math.max(0, chartTime - chart.backgroundVideoStartTime) / 1000
    const targetTime = Number.isFinite(video.duration) && video.duration > 0 ? requestedTime % video.duration : requestedTime
    if (Math.abs(video.currentTime - targetTime) > 0.05) video.currentTime = targetTime
    video.playbackRate = audioRef.current?.playbackRate ?? 1
  }, [audioRef, chart.backgroundVideoStartTime])

  const resetRun = useCallback((startTime = 0) => {
    prerollEpochRef.current += 1; cancelAnimationFrame(prerollFrameRef.current)
    judgedRef.current.clear(); holdStartsRef.current.clear(); holdTicksRef.current.clear(); droppedHoldsRef.current.clear()
    pressedRef.current.clear(); missCursorRef.current = 0; scoringRef.current = { judgedTicks: 0, earnedUnits: 0, combo: 0 }; resultCountsRef.current = { Perfect: 0, Good: 0, Miss: 0 }
    feedbackTimersRef.current.forEach(window.clearTimeout); feedbackTimersRef.current.clear()
    setFeedback([]); setPressed(new Set()); setActiveHoldLanes(new Set()); setScore(0); setAccuracy(100); setCombo(0); setCompleted(false)
    prerollTargetRef.current = startTime
    prerollTimeRef.current = startTime - PREROLL_MS
    needsPrerollRef.current = true
    rendererRef.current?.reset(startTime - PREROLL_MS)
    for (const note of notesByTime) {
      if (note.time >= startTime) break
      judgedRef.current.set(note.id, 'Miss')
      missCursorRef.current++
      scoringRef.current.judgedTicks += 1 + (holdTicksById.get(note.id)?.length ?? 0)
      rendererRef.current?.hideNote(note.id)
    }
    timeRef.current = startTime
    playbackClockRef.current.reset(startTime)
    setDisplayTime(startTime)
    const audio = audioRef.current
    if (audio) { audio.pause(); audio.currentTime = startTime / 1000 }
    syncBackgroundVideoTime(startTime)
    playingRef.current = false; setPlaying(false)
  }, [audioRef, holdTicksById, notesByTime, syncBackgroundVideoTime])

  const processFrame = useCallback((now: number) => {
    timeRef.current = now
    for (const [id, startedAs] of holdStartsRef.current) {
      const note = noteById.get(id)
      if (!note || judgedRef.current.has(id)) continue
      const endTime = note.endTime ?? note.time
      const ticks = holdTicksById.get(id) ?? []
      let nextTickIndex = holdTicksRef.current.get(id) ?? 0
      while (nextTickIndex < ticks.length && ticks[nextTickIndex] <= now) {
        registerJudgment(note.lane, pressedRef.current.has(note.lane) && !droppedHoldsRef.current.has(id) ? 'Perfect' : 'Miss')
        nextTickIndex += 1
      }
      holdTicksRef.current.set(id, nextTickIndex)
      if (now >= endTime) {
        judgedRef.current.set(id, startedAs)
        holdStartsRef.current.delete(id); holdTicksRef.current.delete(id); droppedHoldsRef.current.delete(id)
        rendererRef.current?.setHoldActive(id, false); rendererRef.current?.hideNote(id)
        updateActiveHoldLanes()
      }
    }
    while (missCursorRef.current < notesByTime.length && now - notesByTime[missCursorRef.current].time > windows[2]) {
      const note = notesByTime[missCursorRef.current++]
      if (judgedRef.current.has(note.id) || holdStartsRef.current.has(note.id)) continue
      registerJudgment(note.lane, 'Miss')
      if (note.kind === 'hold') {
        holdStartsRef.current.set(note.id, 'Miss')
        holdTicksRef.current.set(note.id, 0)
        droppedHoldsRef.current.add(note.id)
        rendererRef.current?.setHoldStarted(note.id)
      } else {
        judgedRef.current.set(note.id, 'Miss'); rendererRef.current?.hideNote(note.id)
      }
    }
    const video = backgroundVideoRef.current
    if (video && now >= chart.backgroundVideoStartTime && video.paused && !document.hidden) void video.play().catch(() => undefined)
  }, [chart.backgroundVideoStartTime, holdTicksById, noteById, notesByTime, registerJudgment, updateActiveHoldLanes, windows])

  useEffect(() => {
    if (!playing) return
    const tick = (timestamp: number) => {
      const audio = audioRef.current
      if (!audio || audio.paused) { rafRef.current = requestAnimationFrame(tick); return }
      const now = audio.currentTime * 1000
      processFrame(now)
      if (timestamp - lastUiUpdateRef.current > 70) { setDisplayTime(now); lastUiUpdateRef.current = timestamp }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [audioRef, playing, processFrame])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const handleEnded = () => {
      const endedAt = audio.currentTime * 1000
      playbackClockRef.current.stop(endedAt)
      timeRef.current = endedAt
      playingRef.current = false
      setPlaying(false)
      setDisplayTime(endedAt)
      if (formalSession) setCompleted(true)
    }
    audio.addEventListener('ended', handleEnded)
    return () => audio.removeEventListener('ended', handleEnded)
  }, [audioRef, formalSession])

  useEffect(() => {
    const video = backgroundVideoRef.current
    if (!video) return
    const syncPlayback = () => {
      syncBackgroundVideoTime(audioRef.current?.currentTime ? audioRef.current.currentTime * 1000 : timeRef.current)
      if (playing && prerollTimeRef.current === null && audioRef.current && audioRef.current.currentTime * 1000 >= chart.backgroundVideoStartTime && !document.hidden) void video.play().catch(() => undefined)
      else video.pause()
    }
    syncPlayback()
    document.addEventListener('visibilitychange', syncPlayback)
    return () => { document.removeEventListener('visibilitychange', syncPlayback); video.pause() }
  }, [audioRef, backgroundUrl, chart.backgroundVideoStartTime, playing, syncBackgroundVideoTime])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new PlaytestRenderer({
      canvas, notes, laneTilt: preferences.laneTilt, scrollSpeed: preferences.noteScrollSpeed,
      bpm: chart.bpm, bpmChanges: chart.bpmChanges, offset: chart.offset, duration: chart.duration, getTime: getRenderTime,
      getPlaying: () => playingRef.current,
      autoplay: false,
      transparentBackground: hasCustomBackground,
      initialRenderScale: hasVideoBackground ? 0.9 : 1,
      onStats: setStats,
    })
    rendererRef.current = renderer
    return () => { rendererRef.current = null; renderer.destroy() }
  }, [chart.bpm, chart.bpmChanges, chart.duration, chart.offset, getRenderTime, hasCustomBackground, hasVideoBackground, notes, preferences.laneTilt, preferences.noteScrollSpeed])

  useEffect(() => {
    resetRun(Math.max(0, Math.min(currentTime, chart.duration)))
    return () => { playingRef.current = false; prerollEpochRef.current += 1; cancelAnimationFrame(prerollFrameRef.current); cancelAnimationFrame(rafRef.current); audioRef.current?.pause(); feedbackTimersRef.current.forEach(window.clearTimeout) }
  // This initializes a run when the playtest mounts; editor time changes are intentionally ignored afterward.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current
    if (!audioUrl || !audio) { showToast(text('请先在编辑器的谱面信息中选择可用音频', 'Select usable audio in the editor’s Chart Info first')); return }
    if (playingRef.current) {
      if (prerollTimeRef.current !== null) { resetRun(prerollTargetRef.current); return }
      audio.pause()
      const pausedAt = audio.currentTime * 1000
      playbackClockRef.current.stop(pausedAt)
      playingRef.current = false; setPlaying(false); setDisplayTime(pausedAt); return
    }
    const startAudio = async () => {
      prerollTimeRef.current = null
      audio.playbackRate = playbackRate
      try {
        await audio.play()
        playbackClockRef.current.start(audio.currentTime * 1000, performance.now(), audio.playbackRate)
        playingRef.current = true; setPlaying(true)
      }
      catch { playingRef.current = false; setPlaying(false); showToast(text('音频无法播放，请重新选择文件', 'Audio could not be played; select the file again')) }
    }
    if (!needsPrerollRef.current) { await startAudio(); return }
    needsPrerollRef.current = false
    const targetTime = prerollTargetRef.current
    const epoch = ++prerollEpochRef.current
    const startedAt = performance.now()
    playingRef.current = true; setPlaying(true)
    const advancePreroll = (timestamp: number) => {
      if (epoch !== prerollEpochRef.current || !playingRef.current) return
      const elapsed = Math.min(PREROLL_MS, timestamp - startedAt)
      prerollTimeRef.current = targetTime - PREROLL_MS + elapsed
      if (elapsed < PREROLL_MS) { prerollFrameRef.current = requestAnimationFrame(advancePreroll); return }
      void startAudio()
    }
    prerollFrameRef.current = requestAnimationFrame(advancePreroll)
  }, [audioRef, audioUrl, playbackRate, resetRun, showToast])

  const restart = useCallback(() => resetRun(0), [resetRun])

  const hitLane = useCallback((lane: number) => {
    if (prerollTimeRef.current !== null) return
    const now = getRenderTime(); timeRef.current = now
    const reconnecting = notes.find((note) => note.kind === 'hold' && note.lane === lane && holdStartsRef.current.has(note.id) && !judgedRef.current.has(note.id) && now < (note.endTime ?? note.time) && droppedHoldsRef.current.has(note.id))
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
    if (candidate.kind === 'hold') {
      holdStartsRef.current.set(candidate.id, result); holdTicksRef.current.set(candidate.id, 0); droppedHoldsRef.current.delete(candidate.id)
      rendererRef.current?.setHoldActive(candidate.id, true); updateActiveHoldLanes()
    } else { judgedRef.current.set(candidate.id, result); rendererRef.current?.hideNote(candidate.id) }
    registerJudgment(lane, result)
  }, [getRenderTime, notes, notesByLane, registerJudgment, updateActiveHoldLanes, windows])

  const pressLane = useCallback((lane: number) => {
    if (pressedRef.current.has(lane)) return
    pressedRef.current = new Set(pressedRef.current).add(lane); setPressed(new Set(pressedRef.current)); rendererRef.current?.setLanePressed(lane, true); hitLane(lane); updateActiveHoldLanes()
  }, [hitLane, updateActiveHoldLanes])

  const releaseLane = useCallback((lane: number) => {
    const next = new Set(pressedRef.current); next.delete(lane); pressedRef.current = next; setPressed(next); rendererRef.current?.setLanePressed(lane, false)
    const active = notes.find((note) => note.kind === 'hold' && note.lane === lane && holdStartsRef.current.has(note.id) && !judgedRef.current.has(note.id) && timeRef.current < (note.endTime ?? note.time))
    if (active) { droppedHoldsRef.current.add(active.id); rendererRef.current?.setHoldActive(active.id, false) }
    updateActiveHoldLanes()
  }, [notes, updateActiveHoldLanes])

  const pressTouchLane = useCallback((event: React.PointerEvent<HTMLButtonElement>, lane: number) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pressLane(lane)
  }, [pressLane])

  const releaseTouchLane = useCallback((event: React.PointerEvent<HTMLButtonElement>, lane: number) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    releaseLane(lane)
  }, [releaseLane])

  useEffect(() => {
    const keyMap = new Map(preferences.playKeys.map((key, lane) => [key.toLowerCase(), lane]))
    const down = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (event.code === 'Escape') { if (formalSession) { platform.leavePlay(); navigate(formalSession.returnRoute) } else navigate('editor'); return }
      if (event.code === 'Space') { event.preventDefault(); void togglePlayback(); return }
      const lane = keyMap.get(event.key.toLowerCase()); if (lane !== undefined) { event.preventDefault(); pressLane(lane) }
    }
    const up = (event: KeyboardEvent) => { const lane = keyMap.get(event.key.toLowerCase()); if (lane !== undefined) releaseLane(lane) }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [formalSession, platform, preferences.playKeys, pressLane, releaseLane, togglePlayback])

  const laneX = (lane: number) => getPlaytestLaneCenterPercent(lane, preferences.laneTilt)
  const trackInset = `${(1 - getPlaytestTrackHalfWidth(preferences.laneTilt)) * 50}%`
  const leave = () => {
    audioRef.current?.pause()
    if (formalSession) { platform.leavePlay(); navigate(formalSession.returnRoute) }
    else { editor.setCurrentTime(timeRef.current); navigate('editor') }
  }

  return <div className="playtest-page page-enter" style={{ '--playtest-track-inset': trackInset } as React.CSSProperties}>
    {formalSession && <audio ref={formalAudioRef} src={audioUrl} preload="auto" />}
    {backgroundUrl && chart.backgroundType === 'image' && <img key={backgroundUrl} className="playtest-background" src={backgroundUrl} alt="" decoding="async" />}
    {backgroundUrl && chart.backgroundType === 'video' && <video key={backgroundUrl} ref={backgroundVideoRef} className="playtest-background" data-active={displayTime >= chart.backgroundVideoStartTime} src={backgroundUrl} muted loop playsInline preload="metadata" disablePictureInPicture onLoadedMetadata={() => syncBackgroundVideoTime(timeRef.current)} />}
    <canvas ref={canvasRef} className="playtest-canvas" aria-label={text('WebGL2 谱面试玩画面', 'WebGL2 chart playtest')} />
    <div className="playtest-vignette" /><div className="playtest-judgment-line" />
    <header className="playtest-header">
      <Button variant="outline" onClick={leave}><ArrowLeft />{formalSession ? text('退出游玩', 'Leave play') : text('返回编辑器', 'Back to editor')}</Button>
      <div className="playtest-title"><span className="eyebrow">MOONWEAVE · {formalSession ? 'OFFICIAL PLAY' : 'PLAYTEST'}</span><strong>{chart.title}</strong><small>{chart.artist || chart.audioName}</small></div>
      <div className="playtest-header-actions"><Button variant="outline" size="icon" title={text('重新开始', 'Restart')} onClick={restart}><RotateCcw /></Button><Button variant="outline" size="icon" title={playing ? text('暂停', 'Pause') : text('播放', 'Play')} onClick={() => void togglePlayback()}>{playing ? <Pause /> : <Play />}</Button></div>
    </header>
    <aside className="playtest-score"><span>SCORE</span><strong>{score.toString().padStart(8, '0')}</strong><span>ACCURACY</span><strong>{accuracy.toFixed(2)}%</strong></aside>
    <aside className="playtest-performance"><div><Gauge /><span><b>{stats.fps || '—'} FPS · P95 {stats.frameTimeP95.toFixed(1)} MS</b><small>MAX {stats.frameTimeMax.toFixed(1)} MS · {Math.round(stats.renderScale * 100)}% SCALE</small></span></div><div><Sparkles /><span><b>{stats.notes} NOTES · {stats.particles} FX</b><small>{stats.longFramePercent.toFixed(1)}% LONG · {stats.clockStalls} CLOCK STALLS</small></span></div></aside>
    {feedback.map((effect) => <div key={`sprite-${effect.id}`} className={`legacy-hit-effect ${effect.result.toLowerCase()} ${effect.lane === 0 || effect.lane === 3 ? 'light' : 'conflict'}`} style={{ left: `${laneX(effect.lane)}%` }}><i style={{ backgroundImage: `url(${effectTexture(effect.lane, effect.result)})` }} /></div>)}
    {feedback.map((effect) => <div key={`judge-${effect.id}`} className={`playtest-judge-text ${effect.result.toLowerCase()}`} style={{ left: `${laneX(effect.lane)}%` }}>{effect.result}</div>)}
    {[...activeHoldLanes].map((lane) => <i key={lane} className={`playtest-hold-effect ${lane === 0 || lane === 3 ? 'light' : 'conflict'}`} style={{ left: `${laneX(lane)}%`, backgroundImage: `url(${effectTexture(lane)})` }} />)}
    {combo > 0 && <div key={combo} className="playtest-combo"><b>{combo}</b><span>COMBO</span></div>}
    {!playing && !completed && <Button variant="outline" className="playtest-paused" onClick={() => void togglePlayback()}><Play fill="currentColor" /><b>{displayTime > 0 ? text('继续', 'Continue') : formalSession ? text('开始游玩', 'Start play') : text('开始试玩', 'Start playtest')}</b><span>SPACE</span></Button>}
    <div className="playtest-key-caps">{preferences.playKeys.map((key, lane) => <button key={`${key}-${lane}`} aria-label={text(`轨道 ${lane + 1}，按键 ${key}`, `Lane ${lane + 1}, key ${key}`)} className={pressed.has(lane) ? 'pressed' : ''} style={{ '--lane-x': `${laneX(lane)}%` } as React.CSSProperties} onContextMenu={(event) => event.preventDefault()} onPointerDown={(event) => pressTouchLane(event, lane)} onPointerUp={(event) => releaseTouchLane(event, lane)} onPointerCancel={(event) => releaseTouchLane(event, lane)} onLostPointerCapture={() => releaseLane(lane)}><span>{key}</span></button>)}</div>
    <div className="playtest-progress"><i style={{ width: `${Math.max(0, Math.min(100, displayTime / Math.max(1, duration) * 100))}%` }} /></div>
    <Dialog open={completed} onOpenChange={() => undefined}><DialogContent showCloseButton={false} className="result-dialog">
      <DialogHeader><span className="eyebrow">PLAY RESULT</span><DialogTitle>{text('演奏完成', 'Chart cleared')}</DialogTitle><DialogDescription>{chart.title} · {chart.artist}</DialogDescription></DialogHeader>
      <div className="result-grade">{accuracy >= 99 ? 'SS' : accuracy >= 95 ? 'S' : accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : 'C'}</div>
      <div className="result-score"><span>SCORE</span><strong>{score.toString().padStart(8, '0')}</strong><small>{accuracy.toFixed(2)}% ACCURACY</small></div>
      <div className="result-judgments"><div><span>PERFECT</span><b>{resultCountsRef.current.Perfect}</b></div><div><span>GOOD</span><b>{resultCountsRef.current.Good}</b></div><div><span>MISS</span><b>{resultCountsRef.current.Miss}</b></div><div><span>MAX COMBO</span><b>{combo}</b></div></div>
      <div className="result-actions"><Button onClick={() => resetRun(0)}><RotateCcw />{text('再来一次', 'Retry')}</Button><Button variant="outline" onClick={leave}><ArrowLeft />{text('退出游玩', 'Leave play')}</Button></div>
    </DialogContent></Dialog>
  </div>
}
