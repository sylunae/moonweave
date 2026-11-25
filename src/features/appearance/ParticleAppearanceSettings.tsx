import { Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '@/app/i18n'
import { usePreferences } from '@/app/preferences'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { particleAppearanceCopy as copy } from '@/config/app'
import { defaultHoldSprite, defaultTapSprite, ParticleSprite, useParticleAppearance } from './ParticleSprite'
import { addParticleAppearance, deleteParticleAppearance, listParticleAppearances, renameParticleAppearance, type ParticleAppearance } from './particleLibrary'

type Mode = 'add' | 'rename' | 'remove'
type FileIssue = { field: 'tap' | 'hold'; reason: 'invalid' | 'format' | 'limits' }

export function ParticleAppearanceSettings() {
  const { text } = useI18n()
  const label = (key: keyof typeof copy) => text(copy[key].zh, copy[key].en)
  const { preferences, setPreferences } = usePreferences()
  const [appearances, setAppearances] = useState<ParticleAppearance[]>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [mode, setMode] = useState<Mode | null>(null)
  const [name, setName] = useState('')
  const [files, setFiles] = useState<{ tap?: File; hold?: File }>({})
  const [issue, setIssue] = useState<FileIssue | 'saveFailed' | null>(null)
  const [busy, setBusy] = useState(false)
  const operation = useRef<AbortController | null>(null)
  const selected = appearances?.find(({ id }) => id === preferences.particleAppearanceId)
  const atlas = useParticleAppearance(selected?.id)

  useEffect(() => {
    let active = true
    void listParticleAppearances().then((items) => {
      if (active) { setAppearances(items); setLoadFailed(false) }
    }).catch(() => { if (active) setLoadFailed(true) })
    return () => { active = false }
  }, [loadAttempt])

  useEffect(() => () => operation.current?.abort(), [])

  const selectAppearance = (id: string | null) => setPreferences((current) => ({ ...current, particleAppearanceId: id }))
  const open = (next: Mode) => {
    setName(next === 'rename' ? selected?.name ?? '' : '')
    setFiles({})
    setIssue(null)
    setMode(next)
  }

  const close = (isOpen: boolean) => { if (!isOpen && !operation.current) setMode(null) }

  const save = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!mode || operation.current) return
    const controller = new AbortController()
    operation.current = controller
    const { signal } = controller
    setBusy(true)
    setIssue(null)
    try {
      if (mode === 'add' && files.tap && files.hold && name.trim()) {
        const { parseParticleAtlas, ParticleImportError } = await import('./parseParticleAtlas')
        const parse = async (field: 'tap' | 'hold', file: File) => {
          try { return await parseParticleAtlas(file, signal) }
          catch (error) {
            if (error instanceof ParticleImportError && !signal.aborted) setIssue({ field, reason: error.reason })
            throw error
          }
        }
        const tap = await parse('tap', files.tap)
        const hold = await parse('hold', files.hold)
        signal.throwIfAborted()
        const appearance = { id: crypto.randomUUID(), name: name.trim() }
        await addParticleAppearance(appearance, { tap, hold })
        if (signal.aborted) return
        setAppearances((items = []) => [...items, appearance])
        selectAppearance(appearance.id)
      } else if (mode === 'rename' && selected && name.trim()) {
        const appearance = { ...selected, name: name.trim() }
        await renameParticleAppearance(appearance)
        if (signal.aborted) return
        setAppearances((items) => items?.map((item) => item.id === appearance.id ? appearance : item))
      } else if (mode === 'remove' && selected) {
        await deleteParticleAppearance(selected.id)
        if (signal.aborted) return
        setAppearances((items) => items?.filter((item) => item.id !== selected.id))
        setPreferences((current) => current.particleAppearanceId === selected.id ? { ...current, particleAppearanceId: null } : current)
      } else return
      setMode(null)
    } catch {
      if (!signal.aborted) setIssue((current) => current ?? 'saveFailed')
    } finally {
      operation.current = null
      if (!signal.aborted) setBusy(false)
    }
  }

  const issueMessage = issue === 'saveFailed' ? label(issue) : issue && `${label(issue.field)} · ${label(issue.reason)}`
  return <section className="settings-pane">
    <div className="settings-title">
      <span><Sparkles size={18} /></span>
      <div><h3>{label('title')}</h3><p>{label('description')}</p></div>
    </div>
    <div className="particle-appearance-actions">
      <NativeSelect className="particle-appearance-select" aria-label={label('selected')} value={selected?.id ?? ''} disabled={!appearances || busy} onChange={(event) => selectAppearance(event.target.value || null)}>
        <NativeSelectOption value="">{label('builtIn')}</NativeSelectOption>
        {appearances?.map((item) => <NativeSelectOption value={item.id} key={item.id}>{item.name}</NativeSelectOption>)}
      </NativeSelect>
      <Button variant="outline" size="sm" disabled={!appearances || busy} onClick={() => open('add')}><Plus />{label('add')}</Button>
      {selected && <>
        <Button variant="outline" size="icon-sm" disabled={busy} aria-label={label('rename')} title={label('rename')} onClick={() => open('rename')}><Pencil /></Button>
        <Button variant="outline" size="icon-sm" disabled={busy} aria-label={label('remove')} title={label('remove')} onClick={() => open('remove')}><Trash2 /></Button>
      </>}
    </div>
    {loadFailed ? <div className="flex flex-wrap items-center gap-2 pt-3" role="status">
      <span className="text-sm">{label('loadFailed')}</span>
      <Button variant="outline" size="sm" onClick={() => { setLoadFailed(false); setLoadAttempt((value) => value + 1) }}>{label('retry')}</Button>
    </div> : !appearances || (selected && atlas === undefined) ? <p className="mt-3 text-sm" role="status">{label('loading')}</p>
      : atlas === null ? <p className="mt-3 text-sm" role="status">{label('previewFailed')}</p>
      : <div className="particle-appearance-previews">
        {(['tap', 'hold'] as const).map((kind) => <div className="particle-appearance-preview" key={kind}>
          <ParticleSprite className="particle-appearance-sample" defaultSrc={kind === 'tap' ? defaultTapSprite : defaultHoldSprite} atlas={atlas?.[kind]} loop reduceMotion={preferences.reduceMotion} />
          <span>{label(kind)}</span>
        </div>)}
      </div>}
    <Dialog open={mode === 'add' || mode === 'rename'} onOpenChange={close}>
      <DialogContent showCloseButton={!busy} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader><DialogTitle>{label(mode === 'rename' ? 'rename' : 'add')}</DialogTitle><DialogDescription>{label(mode === 'rename' ? 'renameDescription' : 'formats')}</DialogDescription></DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
          <label className="flex flex-col gap-2">{label('name')}<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} required disabled={busy} /></label>
          {mode === 'add' && (['tap', 'hold'] as const).map((kind) => <label className="flex flex-col gap-2" key={kind}>{label(kind)}
            <Input type="file" accept="image/gif,image/png,.gif,.png" required disabled={busy} aria-invalid={typeof issue === 'object' && issue?.field === kind} onChange={(event) => {
              setFiles({ ...files, [kind]: event.target.files?.[0] })
              setIssue(null)
            }} />
          </label>)}
          {issueMessage && <p role="alert" className="text-sm text-destructive">{issueMessage}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setMode(null)}>{label('cancel')}</Button>
            <Button type="submit" disabled={busy || !/\S/.test(name) || (mode === 'add' && (!files.tap || !files.hold))}>{label(busy && mode === 'add' ? 'importing' : 'save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={mode === 'remove'} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{label('remove')}</AlertDialogTitle><AlertDialogDescription>{label('removeDescription')}</AlertDialogDescription></AlertDialogHeader>
        {issueMessage && <p role="alert" className="text-sm text-destructive">{issueMessage}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{label('cancel')}</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={() => void save()}>{label('remove')}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
}
