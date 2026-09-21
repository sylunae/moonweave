import { useEffect, useState } from 'react'
import { Database, FileDown, FileUp, Film, FolderOpen, Gauge, ImagePlus, Library, Music2, Piano, Plus, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react'
import { navigate } from '@/app/navigation'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { useChart } from '@/features/chart/ChartProvider'

const BPM_MIN = 20
const BPM_MAX = 400

export default function ChartSetupPage() {
  const {
    chart, setChart, activeChartId, charts, libraryReady, storageStatus, chooseAudio, loadChart, saveChart,
    createChart, selectChart, deleteChart, chooseBackground, removeBackground, revealLibrary, showToast,
  } = useChart()
  const [bpmDraft, setBpmDraft] = useState(String(chart.bpm))
  const [offsetDraft, setOffsetDraft] = useState(String(chart.offset))
  const [deleteId, setDeleteId] = useState('')
  useEffect(() => setBpmDraft(String(chart.bpm)), [chart.bpm])
  useEffect(() => setOffsetDraft(String(chart.offset)), [chart.offset])

  const applyBpm = (value: number) => {
    if (!Number.isFinite(value) || value < BPM_MIN || value > BPM_MAX) return
    setChart((previous) => {
      if (value === previous.bpm) return previous
      const scale = previous.bpm / value
      const scaleFromOffset = (time: number) => previous.offset + (time - previous.offset) * scale
      return { ...previous, bpm: value, notes: previous.notes.map((note) => ({ ...note, time: scaleFromOffset(note.time), endTime: note.endTime === undefined ? undefined : scaleFromOffset(note.endTime) })) }
    })
  }
  const applyOffset = (value: number) => {
    if (!Number.isFinite(value)) return
    setChart((previous) => {
      const delta = value - previous.offset
      if (!delta) return previous
      return { ...previous, offset: value, notes: previous.notes.map((note) => ({ ...note, time: note.time + delta, endTime: note.endTime === undefined ? undefined : note.endTime + delta })) }
    })
  }
  const updateSettings = (patch: Partial<typeof chart.settings>) => setChart((current) => ({ ...current, settings: { ...current.settings, ...patch } }))

  return <div className="page chart-setup-page page-enter">
    <header className="page-header chart-page-header">
      <div><span className="eyebrow">CHART SETUP</span><h1>谱面配置</h1></div>
      <div className="page-actions"><Button variant="outline" onClick={() => void loadChart()}><FileUp />导入 JSON</Button><Button variant="outline" onClick={() => void saveChart()}><FileDown />导出</Button><Button onClick={() => navigate('editor')}><Piano />进入编辑器</Button></div>
    </header>

    <div className="setup-grid">
      <section className="setup-card setup-card-wide chart-library-card">
        <div className="setup-card-heading chart-library-heading"><span><Library /></span><div><h2>谱面管理</h2><p>谱面与音频会自动保存在{window.sylunae ? '应用内部目录' : '当前浏览器'}，再次打开即可继续。</p></div><div className="chart-library-actions"><Button variant="outline" size="sm" onClick={() => void revealLibrary()}>{window.sylunae ? <FolderOpen /> : <Database />}{window.sylunae ? '存储位置' : '存储说明'}</Button><Button size="sm" onClick={() => void createChart()}><Plus />新建谱面</Button></div></div>
        <div className="chart-library-status"><span>{libraryReady ? `${charts.length} 份谱面` : '正在读取谱面库…'}</span><span data-status={storageStatus}>{storageStatus === 'loading' ? '正在载入' : storageStatus === 'saving' ? '正在保存…' : storageStatus === 'error' ? '保存失败' : '已自动保存'}</span></div>
        <div className="chart-library-list" aria-label="谱面库">
          {charts.map((item) => <div key={item.id} className={`chart-library-item${item.id === activeChartId ? ' active' : ''}`}>
            <button className="chart-library-select" disabled={item.id === activeChartId} onClick={() => void selectChart(item.id)}>
              <span><strong>{item.title || '未命名谱面'}</strong><small>{item.artist || '未知艺术家'} · {item.noteCount} NOTES</small></span>
              <time dateTime={new Date(item.updatedAt).toISOString()}>{new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(item.updatedAt)}</time>
            </button>
            <Button variant="ghost" size="icon-sm" title="删除谱面" aria-label={`删除 ${item.title || '未命名谱面'}`} onClick={() => setDeleteId(item.id)}><Trash2 /></Button>
          </div>)}
        </div>
      </section>

      <section className="setup-card setup-card-wide">
        <div className="setup-card-heading"><span><Music2 /></span><div><h2>歌曲信息</h2><p>音频上传后会复制到当前谱面的内部存储，不依赖原文件位置。</p></div></div>
        <div className="config-form two-columns">
          <label><span>歌曲标题</span><Input value={chart.title} onChange={(event) => setChart((current) => ({ ...current, title: event.target.value }))} /></label>
          <label><span>艺术家</span><Input value={chart.artist} placeholder="Unknown artist" onChange={(event) => setChart((current) => ({ ...current, artist: event.target.value }))} /></label>
          <label><span>BPM</span><Input inputMode="decimal" value={bpmDraft} onChange={(event) => { const raw = event.target.value; setBpmDraft(raw); if (raw !== '') applyBpm(Number(raw)) }} onBlur={() => { const value = Number(bpmDraft); if (bpmDraft === '' || !Number.isFinite(value) || value < BPM_MIN || value > BPM_MAX) { showToast(`BPM 需在 ${BPM_MIN}–${BPM_MAX} 之间`); setBpmDraft(String(chart.bpm)) } }} /></label>
          <label><span>谱面偏移（ms）</span><Input inputMode="numeric" value={offsetDraft} onChange={(event) => { const raw = event.target.value; setOffsetDraft(raw); if (raw !== '' && Number.isFinite(Number(raw))) applyOffset(Number(raw)) }} onBlur={() => { if (offsetDraft === '' || !Number.isFinite(Number(offsetDraft))) { showToast('偏移值必须是有效毫秒数'); setOffsetDraft(String(chart.offset)) } }} /></label>
        </div>
        <button className="audio-drop" onClick={() => void chooseAudio()}><span className="audio-icon"><Upload /></span><span><strong>{chart.audioName || '上传音频文件'}</strong><small>MP3、WAV、OGG、M4A 或 FLAC · 上传后由 Moonweave 内部管理</small></span><b>{chart.audioName ? '替换音频' : '上传文件'}</b></button>
        <div className="managed-media-row">
          <button className="audio-drop" onClick={() => void chooseBackground()}><span className="audio-icon">{chart.backgroundType === 'video' ? <Film /> : <ImagePlus />}</span><span><strong>{chart.backgroundName || '上传试玩背景'}</strong><small>PNG、JPEG、WebP、AVIF、MP4 或 WebM · 图片静态显示，视频静音循环</small></span><b>{chart.backgroundName ? '替换背景' : '上传背景'}</b></button>
          {chart.backgroundName && <Button variant="outline" size="icon" title="移除背景" aria-label="移除试玩背景" onClick={() => void removeBackground()}><X /></Button>}
        </div>
      </section>

      <section className="setup-card">
        <div className="setup-card-heading"><span><Gauge /></span><div><h2>轨道表现</h2><p>控制试玩时的视觉角度与下落速度。</p></div></div>
        <label className="slider-setting"><span><strong>轨道倾斜度</strong><small>只改变透视，不影响判定</small></span><div><Slider min={0} max={45} value={[chart.settings.laneTilt]} onValueChange={([value]) => updateSettings({ laneTilt: value })} /><output>{chart.settings.laneTilt}°</output></div></label>
        <label className="slider-setting"><span><strong>下落速度</strong><small>试玩时音符的视觉速度</small></span><div><Slider min={4} max={12} step={.5} value={[chart.settings.scrollSpeed]} onValueChange={([value]) => updateSettings({ scrollSpeed: value })} /><output>{chart.settings.scrollSpeed}</output></div></label>
      </section>

      <section className="setup-card">
        <div className="setup-card-heading"><span><SlidersHorizontal /></span><div><h2>判定与按键</h2><p>设置判定窗口和四条轨道的默认输入。</p></div></div>
        <div className="config-block"><span>判定宽松度</span><div className="moon-segmented">{(['strict', 'standard', 'relaxed'] as const).map((value, index) => <button key={value} className={chart.settings.timingWindow === value ? 'active' : ''} onClick={() => updateSettings({ timingWindow: value })}>{['严格', '标准', '宽松'][index]}</button>)}</div></div>
        <div className="config-block"><span>默认按键</span><div className="key-inputs">{chart.settings.keys.map((key, index) => <Input key={index} value={key} maxLength={1} aria-label={`轨道 ${index + 1} 按键`} onChange={(event) => { const keys = [...chart.settings.keys]; keys[index] = event.target.value.slice(-1).toUpperCase(); updateSettings({ keys }) }} />)}</div></div>
      </section>
    </div>
    <AlertDialog open={Boolean(deleteId)} onOpenChange={(open) => { if (!open) setDeleteId('') }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>删除这份谱面？</AlertDialogTitle><AlertDialogDescription>谱面数据与内部保存的音频、背景媒体都会被永久删除。此操作无法撤销。</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { const id = deleteId; setDeleteId(''); void deleteChart(id) }}>删除谱面</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
}
