import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useI18n } from '@/app/i18n'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { GameSelect } from '@/components/ui/game-select'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { notePropertiesCopy as copy } from '@/config/app'
import { useChart } from '../ChartProvider'
import { beatAtTime } from '../tempoMap'
import type { ChartNote } from '../types'
import {
  defaultNoteAnimation, isHitChannel, motionChannels, motionLimits, motionPreset, motionPresets, motionValue,
  validMotionValue, type Interpolation, type MotionChannel, type MotionKey, type MotionPreset, type NoteAnimation,
} from './noteAnimation'

const pageSize = 8
const curves = ['step', 'linear', 'smooth'] as const
const animationOf = (note: ChartNote) => note.animation ?? defaultNoteAnimation
type PropertyLabel = (key: keyof typeof copy) => string
type EditNotes = (patch: (note: ChartNote) => ChartNote | null) => boolean

function commonValue<Item, Value>(items: readonly Item[], read: (item: Item) => Value): Value | undefined {
  if (!items.length) return undefined
  const first = read(items[0])
  return items.every(item => read(item) === first) ? first : undefined
}

function NumberProperty({ label, value, onCommit }: {
  label: string; value: number | undefined; onCommit(value: number): void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return <Input
    aria-label={label} inputMode="decimal" placeholder="-" value={draft ?? value ?? ''} data-draft={draft !== null ? '' : undefined}
    onFocus={event => event.currentTarget.select()}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => {
      if (draft?.trim()) onCommit(Number(draft))
      setDraft(null)
    }}
    onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur()
      if (event.key === 'Escape') { event.preventDefault(); setDraft(null) }
    }}
  />
}

function withAnimation(note: ChartNote, animation?: NoteAnimation): ChartNote {
  if (animation && (animation.speed !== 1 || Object.keys(animation.keys).length)) return { ...note, animation }
  if (!note.animation) return note
  const { animation: _, ...rest } = note
  return rest
}

export default function NotePropertiesPanel({ notes }: { notes: ChartNote[] }) {
  const { chart, commitEdit, currentTime } = useChart()
  const { text } = useI18n()
  const [invalidSpeed, setInvalidSpeed] = useState(false)
  const resetButton = useRef<HTMLButtonElement>(null)
  const label: PropertyLabel = key => text(copy[key][0], copy[key][1])
  const selection = useMemo(() => ({
    ids: new Set(notes.map(note => note.id)),
    role: commonValue(notes, note => note.visualOnly ? 'visual' : 'play'),
    status: commonValue(notes, note => note.disabled ? 'disabled' : 'enabled'),
    speed: commonValue(notes, note => animationOf(note).speed),
    hasEffects: notes.some(note => note.animation),
    firstTime: notes.reduce((time, note) => Math.min(time, note.time), Infinity),
  }), [notes])

  const edit: EditNotes = patch => {
    let collision = false
    commitEdit(previous => {
      let changed = false
      const updated = previous.notes.map(note => {
        if (!selection.ids.has(note.id)) return note
        const next = patch(note)
        collision ||= next === null
        changed ||= next !== null && next !== note
        return next ?? note
      })
      return changed && !collision ? { ...previous, notes: updated } : previous
    })
    return !collision
  }

  return <div className="note-properties-scroll" data-scroll-region>
    <div className="note-property">
      <span>{label('status')}</span>
      <ToggleGroup type="single" value={selection.status ?? ''} aria-label={label('status')} variant="outline" size="sm" onValueChange={status => {
        if (!status) return
        const disabled = status === 'disabled'
        edit(note => {
          if (!!note.disabled === disabled) return note
          if (disabled) return { ...note, disabled: true }
          const { disabled: _, ...rest } = note
          return rest
        })
      }}>
        <ToggleGroupItem value="enabled">{label('enabled')}</ToggleGroupItem>
        <ToggleGroupItem value="disabled">{label('disabled')}</ToggleGroupItem>
      </ToggleGroup>
    </div>
    <div className="note-property">
      <span>{label('role')}</span>
      <ToggleGroup type="single" value={selection.role ?? ''} aria-label={label('role')} variant="outline" size="sm" onValueChange={role => {
        if (!role) return
        const visualOnly = role === 'visual'
        edit(note => {
          if (!!note.visualOnly === visualOnly) return note
          if (visualOnly) return { ...note, visualOnly: true }
          const { visualOnly: _, ...rest } = note
          return rest
        })
      }}>
        <ToggleGroupItem value="play">{label('play')}</ToggleGroupItem>
        <ToggleGroupItem value="visual">{label('visual')}</ToggleGroupItem>
      </ToggleGroup>
    </div>
    <label className="note-property">
      <span>{label('base')} <small className="note-property-range">{motionLimits.speed.join(' … ')}</small></span>
      <NumberProperty label={label('base')} value={selection.speed} onCommit={speed => {
        const valid = validMotionValue('speed', speed)
        setInvalidSpeed(!valid)
        if (valid) edit(note => animationOf(note).speed === speed ? note : withAnimation(note, { ...animationOf(note), speed }))
      }} />
    </label>
    {invalidSpeed && <p role="alert" className="note-property-error">{label('invalidNumber')}</p>}
    <section className="note-property-section">
      <h3>{label('effects')}</h3>
      <div className="note-effect-actions">
        <GameSelect label={label('preset')} placeholder={label('preset')} value=""
          options={motionPresets.map(preset => [preset, label(preset)] as const)}
          onValueChange={value => {
            const animation = motionPreset(value as MotionPreset, beatAtTime(chart, selection.firstTime))
            edit(note => withAnimation(note, animation))
            setInvalidSpeed(false)
          }} />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button ref={resetButton} variant="outline" disabled={!selection.hasEffects}>{label('reset')}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent onCloseAutoFocus={event => {
            const trigger = resetButton.current
            if (!trigger?.disabled) return
            const properties = trigger.closest<HTMLElement>('.note-properties')
            if (properties) {
              event.preventDefault()
              properties.focus({ preventScroll: true })
            }
          }}>
            <AlertDialogHeader>
              <AlertDialogTitle>{label('reset')}</AlertDialogTitle>
              <AlertDialogDescription>{label('resetDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{label('cancel')}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => {
                edit(note => withAnimation(note))
                setInvalidSpeed(false)
              }}>{label('reset')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
    <section className="note-property-section">
      <h3>{label('keyframes')}</h3>
      {motionChannels.map(channel => <KeyframeTrack key={channel} channel={channel} notes={notes} label={label}
        edit={edit} cursorBeat={() => beatAtTime(chart, currentTime)} />)}
    </section>
  </div>
}

function alignFrameIndices(tracks: ReadonlyMap<string, MotionKey[]>, shortest: MotionKey[]) {
  const sharedTimes = new Set(shortest.map(frame => frame.at))
  for (const frames of tracks.values()) {
    if (frames === shortest) continue
    const times = new Set(frames.map(frame => frame.at))
    for (const time of sharedTimes) {
      if (!times.has(time)) sharedTimes.delete(time)
    }
    if (!sharedTimes.size) return
  }

  const aligned = new Map<string, number[]>()
  for (const [id, frames] of tracks) {
    const sharedIndices = new Map<number, number>()
    const remainingIndices: number[] = []
    frames.forEach((frame, index) => {
      if (sharedTimes.has(frame.at)) sharedIndices.set(frame.at, index)
      else remainingIndices.push(index)
    })
    // Reserve shared times first so an extra key on one note cannot shift the matching row.
    let nextRemaining = 0
    aligned.set(id, shortest.map(frame => sharedIndices.get(frame.at) ?? remainingIndices[nextRemaining++]))
  }
  return aligned
}

function KeyframeTrack({ channel, notes, label, edit, cursorBeat }: {
  channel: MotionChannel; notes: ChartNote[]; label: PropertyLabel; edit: EditNotes; cursorBeat(): number
}) {
  const [page, setPage] = useState(0)
  const [error, setError] = useState<'duplicateTime' | 'invalidNumber'>()
  const hit = isHitChannel(channel)
  const timeLabel = hit ? 'ms' : 'beat'
  const clockOrigin = hit ? 0 : 1
  const selection = useMemo(() => {
    let shortest: MotionKey[] | undefined
    let maxCount = 0, lastTime = -Infinity
    const tracks = new Map<string, MotionKey[]>()
    for (const note of notes) {
      const frames = note.animation?.keys[channel] ?? []
      tracks.set(note.id, frames)
      if (!shortest || frames.length < shortest.length) shortest = frames
      maxCount = Math.max(maxCount, frames.length)
      lastTime = Math.max(lastTime, frames.at(-1)?.at ?? -Infinity)
    }
    const aligned = shortest?.length && shortest.length < maxCount ? alignFrameIndices(tracks, shortest) : undefined
    return {
      tracks, aligned, commonCount: shortest?.length ?? 0, maxCount, lastTime,
    }
  }, [notes, channel])
  const lastPage = Math.max(0, Math.ceil(selection.commonCount / pageSize) - 1)
  const shownPage = Math.min(page, lastPage)
  const frameRows = useMemo(() => {
    const start = shownPage * pageSize
    return Array.from({ length: Math.min(pageSize, selection.commonCount - start) }, (_, row) => {
      const index = start + row
      const frames = Array.from(selection.tracks, ([id, keys]) => keys[selection.aligned?.get(id)?.[index] ?? index])
      const at = commonValue(frames, frame => frame.at)
      return {
        index, time: at === undefined ? undefined : at + clockOrigin,
        value: commonValue(frames, frame => frame.value), curve: commonValue(frames, frame => frame.curve),
      }
    })
  }, [clockOrigin, selection, shownPage])

  function editFrames(patch: (frames: MotionKey[], animation: NoteAnimation, noteId: string) => MotionKey[] | null) {
    const accepted = edit(note => {
      const animation = animationOf(note)
      const frames = animation.keys[channel] ?? []
      const next = patch(frames, animation, note.id)
      if (!next) return null
      if (next === frames) return note
      const keys = { ...animation.keys }
      if (next.length) keys[channel] = next
      else delete keys[channel]
      return withAnimation(note, { ...animation, keys })
    })
    setError(accepted ? undefined : 'duplicateTime')
    return accepted
  }

  function patchFrame(row: number, patch: Partial<MotionKey> | null) {
    editFrames((frames, _animation, noteId) => {
      const index = selection.aligned?.get(noteId)?.[row] ?? row
      const frame = frames[index]
      if (!frame) return frames
      if (!patch) return frames.filter((_, i) => i !== index)
      const next = { ...frame, ...patch }
      if (next.at === frame.at && next.value === frame.value && next.curve === frame.curve) return frames
      if (next.at !== frame.at && frames.some(other => other.at === next.at)) return null
      return frames.map((other, i) => i === index ? next : other).sort((a, b) => a.at - b.at)
    })
  }

  function addFrame() {
    const cursor = hit ? 0 : Math.round(cursorBeat() * 1000) / 1000
    const at = Math.max(cursor, selection.lastTime + (hit ? 100 : 0.25))
    const added = editFrames((frames, animation) => {
      if (frames.at(-1)?.at === at) return null
      const fallback = channel === 'speed' ? animation.speed : channel.toLowerCase().endsWith('opacity') ? 100 : 0
      return [...frames, { at, value: motionValue(frames, at, fallback), curve: 'step' }]
    })
    if (added) setPage(Math.floor(selection.commonCount / pageSize))
  }

  return <section className="note-keyframe-track" aria-label={label(channel)}>
    <header className="note-keyframe-toolbar">
      <h4>{label(channel)}</h4>
      <small className="note-property-range">{motionLimits[channel].join(' … ')}</small>
      <Button variant="outline" size="icon-sm" aria-label={`${label('add')} · ${label(channel)}`} title={label('add')} onClick={addFrame}><Plus /></Button>
    </header>
    {selection.commonCount > 0 && <div className="note-keyframes">
      <div className="note-keyframe-row" aria-hidden="true">
        <span>{label(timeLabel)}</span><span>{label('value')}</span><span>{label('interpolation')}</span>
      </div>
      {frameRows.map(({ index, time, value, curve }) => {
        const fieldLabel = (key: keyof typeof copy) => `${label(key)} · ${index + 1}`
        return <div className="note-keyframe-row" key={index}>
          <NumberProperty label={fieldLabel(timeLabel)} value={time} onCommit={time => {
            if (!Number.isFinite(time) || (hit && time < 0)) { setError('invalidNumber'); return }
            patchFrame(index, { at: time - clockOrigin })
          }} />
          <NumberProperty label={fieldLabel('value')} value={value} onCommit={value => {
            if (!validMotionValue(channel, value)) { setError('invalidNumber'); return }
            patchFrame(index, { value })
          }} />
          <GameSelect label={fieldLabel('interpolation')} value={curve ?? ''} placeholder="-"
            options={curves.map(key => [key, label(key)] as const)}
            onValueChange={curve => patchFrame(index, { curve: curve as Interpolation })} />
          <Button variant="ghost" size="icon-sm" aria-label={fieldLabel('remove')} onClick={() => patchFrame(index, null)}><Trash2 /></Button>
        </div>
      })}
    </div>}
    {!selection.commonCount && selection.maxCount > 0 && <p className="note-property-empty">{label('noCommonKeys')}</p>}
    {lastPage > 0 && <div className="note-keyframe-pagination">
      <Button variant="ghost" size="icon-sm" aria-label={label('previousPage')} disabled={!shownPage} onClick={() => setPage(shownPage - 1)}><ChevronLeft /></Button>
      <span>{shownPage + 1} / {lastPage + 1}</span>
      <Button variant="ghost" size="icon-sm" aria-label={label('nextPage')} disabled={shownPage === lastPage} onClick={() => setPage(shownPage + 1)}><ChevronRight /></Button>
    </div>}
    {error && <p role="alert" className="note-property-error">{label(error)}</p>}
  </section>
}
