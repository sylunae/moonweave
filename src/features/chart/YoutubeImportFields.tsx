import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/app/i18n'
import { GameButton } from '@/components/ui/game-controls'
import { Input } from '@/components/ui/input'
import { youtubeImportCopy as copy } from '@/config/app'
import type { YoutubeChartImport, YoutubeImportAPI } from '@/shared/electron'
import { youtubeVideoId } from '@/shared/youtubeUrl'

export function YoutubeImportFields({ onImported, onDownloading }: {
  onImported(id: string, media: YoutubeChartImport): void
  onDownloading(value: boolean): void
}) {
  const { text } = useI18n()
  const t = (value: { zh: string; en: string }) => text(value.zh, value.en)
  const api = window.sylunae?.platform === 'electron' ? window.moonweave?.youtube : undefined
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Awaited<ReturnType<YoutubeImportAPI['status']>> | 'error' | undefined>()
  const [check, setCheck] = useState(0)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<'install' | 'download'>()
  const [notice, setNotice] = useState<{ zh: string; en: string }>()
  const [error, setError] = useState<{ zh: string; en: string }>()
  const live = useRef(false)
  const request = useRef<string | undefined>(undefined)
  const staged = useRef<string | undefined>(undefined)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      if (request.current) void api?.discard(request.current).catch(() => {})
      if (staged.current) void api?.discard(staged.current).catch(() => {})
    }
  }, [api])

  useEffect(() => {
    if (!open || !api || busy) return
    let current = true
    let timer: number | undefined
    async function refresh(tools: YoutubeImportAPI) {
      try {
        const next = await tools.status()
        if (!current) return
        setStatus(next)
        if (next === 'installing') timer = window.setTimeout(() => void refresh(tools), 1200)
      } catch {
        if (current) setStatus('error')
      }
    }
    void refresh(api)
    return () => { current = false; window.clearTimeout(timer) }
  }, [api, busy, check, open])

  const install = async () => {
    if (!api || busy) return
    setBusy('install')
    setError(undefined)
    try {
      await api.install()
      if (live.current) setStatus('ready')
    } catch {
      if (live.current) setError(copy.installFailed)
    } finally {
      if (live.current) setBusy(undefined)
    }
  }

  const download = async () => {
    if (!api || status !== 'ready' || busy || request.current) return
    setNotice(undefined)
    if (!youtubeVideoId(url)) {
      setError(copy.errors.link)
      return
    }
    const id = crypto.randomUUID()
    request.current = id
    setBusy('download')
    onDownloading(true)
    setError(undefined)
    try {
      const result = await api.download(id, url.trim())
      if (!live.current) return
      if (result.ok) {
        staged.current = id
        onImported(id, result.media)
        setNotice(copy.imported)
      } else {
        setError(copy.errors[result.reason])
      }
    } catch {
      if (live.current) setError(copy.errors.failed)
    } finally {
      request.current = undefined
      if (live.current) {
        setBusy(undefined)
        onDownloading(false)
      }
    }
  }

  return <div className="wide space-y-2">
    <GameButton type="button" aria-expanded={open} disabled={busy === 'download'} onClick={() => setOpen(!open)}>{t(copy.toggle)}</GameButton>
    {open && <>
      {!api || status === 'unsupported' ? <small className="block">{t(copy.unsupported)}</small> : <>
        {status === 'ready' ? <>
          <label>{t(copy.link)}<Input inputMode="url" autoComplete="off" maxLength={4096} placeholder="https://www.youtube.com/watch?v=…"
            disabled={busy === 'download'} value={url} onChange={event => { setUrl(event.target.value); setError(undefined); setNotice(undefined) }}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void download() } }} /></label>
          <GameButton type="button" disabled={Boolean(busy) || !url.trim()} onClick={() => void download()}>{t(copy.download)}</GameButton>
        </> : status === 'error' ? <div className="library-media-picker">
          <small role="alert">{t(copy.statusFailed)}</small><GameButton type="button" onClick={() => { setStatus(undefined); setCheck(value => value + 1) }}>{t(copy.retry)}</GameButton>
        </div> : status === 'missing' && !busy ? <>
          <small className="block">{t(copy.requirements)}</small>
          <GameButton type="button" onClick={() => void install()}>{t(copy.install)}</GameButton>
        </> : <small className="block" role="status">{t(busy === 'install' || status === 'installing' ? copy.installing : copy.loading)}</small>}
        {busy === 'download' && <small className="block" role="status">{t(copy.downloading)}</small>}
        {notice && <small className="block" role="status">{t(notice)}</small>}
        {error && <small className="block" role="alert">{t(error)}</small>}
      </>}
    </>}
  </div>
}
