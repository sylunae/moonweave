import { useState } from 'react'
import { Download, FileUp, FolderOpen, Library, Music2, Plus, Trash2 } from 'lucide-react'
import { navigate } from '@/app/navigation'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useChart } from '@/features/chart/ChartProvider'

const formatUpdatedAt = (value: number) => new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(value)

export default function ChartManagementPage() {
  const {
    activeChartId, charts, libraryReady, storageStatus, createChart, selectChart, deleteChart,
    importChart, exportChart, revealLibrary,
  } = useChart()
  const [deleteId, setDeleteId] = useState('')

  const openChart = async (id: string) => {
    if (await selectChart(id)) navigate('editor')
  }
  const createAndOpen = async () => {
    if (await createChart()) navigate('editor')
  }
  const importAndOpen = async () => {
    if (await importChart()) navigate('editor')
  }
  const storageLabel = storageStatus === 'loading' ? '正在读取谱面库…'
    : storageStatus === 'saving' ? '正在保存'
      : storageStatus === 'error' ? '保存失败' : '已自动保存'

  return <div className="page page-enter chart-management-page">
    <header className="page-header chart-page-header">
      <div><span className="eyebrow">CHART LIBRARY</span><h1>谱面管理</h1><p>管理应用内部保存的谱面。</p></div>
      <div className="page-actions">
        <Button variant="outline" onClick={() => void revealLibrary()}><FolderOpen />存储位置</Button>
        <Button variant="outline" onClick={() => void importAndOpen()}><FileUp />导入谱面</Button>
        <Button onClick={() => void createAndOpen()}><Plus />新建谱面</Button>
      </div>
    </header>

    <section className="setup-card chart-library-card">
      <div className="setup-card-heading chart-library-heading">
        <span><Library /></span>
        <div><h2>内部谱面库</h2><p>{libraryReady ? `${charts.length} 份谱面` : '正在读取谱面库…'}</p></div>
        <div className="chart-storage-status" data-status={storageStatus}>{storageLabel}</div>
      </div>

      {libraryReady && charts.length === 0 ? <div className="chart-library-empty">
        <Music2 />
        <strong>还没有谱面</strong>
        <Button onClick={() => void createAndOpen()}><Plus />新建谱面</Button>
      </div> : <div className="chart-library-list">
        {charts.map((item) => <article key={item.id} className={`chart-library-item${item.id === activeChartId ? ' active' : ''}`}>
          <button className="chart-library-select" onClick={() => void openChart(item.id)}>
            <span className="chart-cover">{item.coverUrl ? <img src={item.coverUrl} alt="" /> : <Music2 />}</span>
            <span><strong>{item.title || '未命名谱面'}</strong><small>{item.artist || '未知艺术家'} · {item.noteCount} NOTES</small></span>
            <time dateTime={new Date(item.updatedAt).toISOString()}>{formatUpdatedAt(item.updatedAt)}</time>
          </button>
          <div className="chart-library-item-actions">
            <Button variant="ghost" size="icon-sm" title="导出谱面" aria-label={`导出 ${item.title || '未命名谱面'}`} onClick={() => void exportChart(item.id)}><Download /></Button>
            <Button variant="ghost" size="icon-sm" title="删除谱面" aria-label={`删除 ${item.title || '未命名谱面'}`} onClick={() => setDeleteId(item.id)}><Trash2 /></Button>
          </div>
        </article>)}
      </div>}
    </section>

    <AlertDialog open={Boolean(deleteId)} onOpenChange={(open) => { if (!open) setDeleteId('') }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这份谱面？</AlertDialogTitle><AlertDialogDescription>谱面数据与内部保存的音频、背景媒体都会被永久删除。此操作无法撤销。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { const id = deleteId; setDeleteId(''); void deleteChart(id) }}>删除谱面</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </div>
}
