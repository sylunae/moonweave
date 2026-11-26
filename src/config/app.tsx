import { Library, Piano } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { englishAppName } from './brand'

export const earlyAccessCopy = {
  title: { zh: '早期版本说明', en: 'Early access' },
  description: {
    zh: '织月制谱目前处于早期开发阶段，暂未提供可下载的应用版本。许多功能仍在制作中，使用时可能会遇到较多 Bug。',
    en: 'Moonweave is in early development. A downloadable app is not yet available. Many features are still in progress, and bugs may be frequent.',
  },
  follow: { zh: '想获取最新资讯，可以在 Instagram 关注作者', en: 'For the latest updates, follow the creator on Instagram' },
  language: { zh: '界面语言', en: 'App language' },
  continue: { zh: '开始使用', en: 'Get started' },
  instagram: { handle: '@sylunae', url: 'https://www.instagram.com/sylunae/' },
} as const

export const settingsCopy = {
  title: { zh: '设置', en: 'Settings' },
} as const

export const chartImportCopy = {
  withMedia: { zh: '导入 JSON 与媒体', en: 'Import JSON with media' },
} as const

export const youtubeImportCopy = {
  toggle: { zh: '从 YouTube 导入', en: 'Import from YouTube' },
  link: { zh: 'YouTube 视频链接', en: 'YouTube video link' },
  unsupported: { zh: 'YouTube 导入需要 Windows x64 桌面版。', en: 'YouTube import requires the Windows x64 desktop app.' },
  install: { zh: '下载并安装插件', en: 'Download and install plugin' },
  requirements: { zh: '首次导入需安装 yt-mp3 插件（yt-dlp 和 FFmpeg，约 53 MB）。', en: 'First-time import requires the yt-mp3 plugin (yt-dlp and FFmpeg, about 53 MB).' },
  loading: { zh: '正在检查插件…', en: 'Checking plugin…' },
  installing: { zh: '正在安装插件…', en: 'Installing plugin…' },
  installFailed: { zh: '插件安装失败，请检查网络后重试。', en: 'Plugin installation failed. Check your connection and try again.' },
  statusFailed: { zh: '无法检查插件状态。', en: 'Could not check plugin status.' },
  retry: { zh: '重试', en: 'Retry' },
  download: { zh: '导入音频与信息', en: 'Import audio and details' },
  downloading: { zh: '正在读取视频信息并下载 MP3…', en: 'Reading video details and downloading MP3…' },
  imported: { zh: '已填入导入信息，可以继续编辑。', en: 'Imported details are ready to edit.' },
  errors: {
    link: { zh: '请输入有效的 YouTube 视频链接。', en: 'Enter a valid YouTube video link.' },
    tools: { zh: '请先安装 yt-mp3 插件。', en: 'Install the yt-mp3 plugin first.' },
    busy: { zh: '另一项导入正在运行，请稍后重试。', en: 'Another import is running. Try again shortly.' },
    duration: { zh: '请选择时长不超过一小时、已结束直播或已发布的视频。', en: 'Choose a published video or completed stream up to one hour long.' },
    failed: { zh: '无法导入视频。请检查网络和视频是否可播放后重试。', en: 'Could not import the video. Check your connection and that the video plays, then try again.' },
  },
} as const

export const playSettingsCopy = {
  trackMode: { zh: '横屏轨道', en: 'Landscape track' },
  tiltedTrack: { zh: '倾斜轨道', en: 'Tilted track' },
  verticalTrack: { zh: '垂直 4K 轨道', en: 'Vertical 4K track' },
  trackBackgroundBlur: { zh: '轨道背景模糊', en: 'Track background blur' },
  judgmentDisplay: { zh: '判定显示位置', en: 'Judgment display position' },
  judgmentLane: { zh: '音符判定线', en: 'Judgment line' },
  judgmentCenter: { zh: '舞台中央', en: 'Center of stage' },
} as const

export const particleAppearanceCopy = {
  title: { zh: '粒子特效', en: 'Particle effects' },
  description: { zh: '设置游玩时点击和长按音符的特效。', en: 'Choose the effects for tap and hold notes during play.' },
  selected: { zh: '当前外观', en: 'Active appearance' },
  builtIn: { zh: '默认外观', en: 'Default appearance' },
  add: { zh: '添加外观', en: 'Add appearance' },
  rename: { zh: '重命名', en: 'Rename' },
  remove: { zh: '删除外观', en: 'Delete appearance' },
  name: { zh: '外观名称', en: 'Appearance name' },
  tap: { zh: '点击特效', en: 'Tap effect' },
  hold: { zh: '长按特效', en: 'Hold effect' },
  formats: { zh: '支持 GIF 动图或按行排列的 4 × 4 PNG 精灵图，每张文件不超过 8 MB。', en: 'Use an animated GIF or a row-major 4 × 4 PNG sprite sheet. Each file can be up to 8 MB.' },
  renameDescription: { zh: '为这套粒子特效设置新名称。', en: 'Give these particle effects a new name.' },
  removeDescription: { zh: '将删除这套特效并切回默认外观。', en: 'These effects will be deleted and the default appearance will be restored.' },
  save: { zh: '保存', en: 'Save' },
  cancel: { zh: '取消', en: 'Cancel' },
  retry: { zh: '重试', en: 'Retry' },
  loading: { zh: '正在读取外观…', en: 'Loading appearances…' },
  importing: { zh: '正在解析特效…', en: 'Processing effects…' },
  loadFailed: { zh: '无法读取自定义外观。', en: 'Could not load custom appearances.' },
  previewFailed: { zh: '无法加载这套特效，游玩时会使用默认外观。', en: 'These effects could not be loaded. Play will use the default appearance.' },
  saveFailed: { zh: '无法保存更改，请重试。', en: 'Could not save your changes. Please try again.' },
  invalid: { zh: '图片无法解析，请检查文件后重试。', en: 'Could not read this image. Check the file and try again.' },
  format: { zh: '请选择 GIF 动图或正方形 4 × 4 PNG 精灵图。', en: 'Choose an animated GIF or a square 4 × 4 PNG sprite sheet.' },
  limits: { zh: '图片超出导入限制。GIF 最长 15 秒、最多 120 帧、边长不超过 1024 像素。PNG 边长不超过 4096 像素。', en: 'Image exceeds import limits. GIFs can be up to 15 seconds, 120 frames and 1024 pixels per side. PNGs can be up to 4096 pixels per side.' },
} as const

export const improvisationCopy = {
  title: { zh: '即兴制谱', en: 'Improvise' },
  entry: { zh: '从当前位置演奏 · 记录敲击并向上退场', en: 'Play from here · Record taps moving upward' },
  save: { zh: '保存这次即兴演奏？', en: 'Save this performance?' },
  description: { zh: '按当前谱面的节拍网格，根据密度对齐至 1/4、1/8 或 1/16 拍，可撤销。', en: 'Align taps to this chart’s beat grid at 1/4, 1/8 or 1/16 of a beat based on density. You can undo this.' },
  discard: { zh: '不保存并退出', en: 'Discard and exit' },
  confirm: { zh: '保存到制谱器', en: 'Save to editor' },
  cancel: { zh: '继续演奏', en: 'Continue performance' },
  conflict: { zh: '这些位置已有音符', en: 'Notes already occupy these positions' },
  conflictDescription: { zh: '覆盖会替换同轨道重叠的原音符（包含长按）；保留则跳过冲突的新音符，其余敲击仍会保存。', en: 'Overwrite replaces overlapping notes in the same lane, including holds. Keep existing skips conflicting new taps and saves the rest.' },
  overwrite: { zh: '覆盖重叠音符', en: 'Overwrite overlaps' },
  keep: { zh: '保留原音符', en: 'Keep existing' },
  failed: { zh: '保存失败，演奏结果仍保留，请重试', en: 'Save failed. Your recording is retained; retry saving.' },
} as const

export const editorEffects = {
  title: { zh: '特效', en: 'Effects' },
  scrollSpeed: { zh: '变速', en: 'Scroll speed' },
  curves: {
    linear: { zh: '线性', en: 'Linear' },
    easeIn: { zh: '缓入', en: 'Ease in' },
    easeOut: { zh: '缓出', en: 'Ease out' },
    easeInOut: { zh: '缓入缓出', en: 'Ease in out' },
    custom: { zh: '自定义', en: 'Custom' },
  },
  curve: { zh: '渐变曲线', en: 'Transition curve' },
  preview: { zh: '速度曲线预览', en: 'Speed curve preview' },
  start: { zh: '起点', en: 'Start' },
  end: { zh: '终点', en: 'End' },
  pick: { zh: '选节拍线', en: 'Pick beat line' },
  remove: { zh: '删除此段', en: 'Delete effect' },
  previous: { zh: '上一段', en: 'Previous effect' },
  next: { zh: '下一段', en: 'Next effect' },
  changed: { zh: '未保存', en: 'Unsaved changes' },
  discard: { zh: '放弃修改', en: 'Discard changes' },
  keepEditing: { zh: '继续编辑', en: 'Keep editing' },
  discardTitle: { zh: '放弃当前修改？', en: 'Discard current changes?' },
  discardDescription: { zh: '当前变速设置尚未保存。', en: 'These speed settings have not been saved.' },
  control: { zh: '控制点', en: 'Control point' },
  invalidCurve: { zh: '四个控制点坐标均需在 0–1 之间', en: 'All four control coordinates must be between 0 and 1' },
  back: { zh: '点击目标节拍线 · Esc 返回设置', en: 'Choose a beat line · Esc to return to settings' },
} as const

export const bpmDetectionCopy = {
  analyzing: { zh: '音频已导入，正在检测 BPM…', en: 'Audio imported. Detecting BPM…' },
  title: { zh: '应用检测到的 BPM？', en: 'Apply detected BPM?' },
  uncertainTitle: { zh: 'BPM 检测结果不确定', en: 'Uncertain BPM estimate' },
  description: { zh: '仅修改初始 BPM，保留音符、特效、偏移和变速点的时间。可撤销。', en: 'Changes only the initial BPM. Note, effect, offset and tempo-change times are preserved. You can undo this.' },
  uncertain: { zh: '节奏不稳定或可能存在变速，请试听确认。', en: 'The rhythm is unclear or may change tempo. Check by listening.' },
  unavailable: { zh: '未找到稳定节奏，请手动设置 BPM。', en: 'No stable rhythm found. Set the BPM manually.' },
  unsupported: { zh: '已跳过 BPM 分析：支持 8 秒至 10 分钟、32 MB 以内的单声道或立体声音频。', en: 'BPM analysis skipped: supports mono/stereo audio from 8 seconds to 10 minutes, up to 32 MB.' },
  failed: { zh: 'BPM 分析失败：音频读取、解码或分析异常，请手动设置。', en: 'BPM analysis failed while reading, decoding or analyzing the audio. Set it manually.' },
  label: { zh: '初始 BPM（估算）', en: 'Initial BPM (estimate)' },
  half: { zh: '半速', en: 'Half' },
  double: { zh: '倍速', en: 'Double' },
  ignore: { zh: '忽略', en: 'Ignore' },
  apply: { zh: '应用 BPM', en: 'Apply BPM' },
  applied: { zh: '已应用初始 BPM，可撤销', en: 'Initial BPM applied. You can undo this.' },
} as const

export type RouteId = 'manage' | 'editor' | 'playtest'

export const noteImportTitle = { zh: '导入音符', en: 'Import notes' }
export const backgroundVideoPreviewCopy = {
  title: { zh: '视频同步预览', en: 'Video sync preview' },
  close: { zh: '关闭视频预览', en: 'Close video preview' },
  muted: { zh: '视频静音', en: 'Video muted' },
  waiting: { zh: '等待视频开始', en: 'Waiting for video to start' },
  videoError: { zh: '无法播放背景视频', en: 'Unable to play background video' },
  audioRequired: { zh: '请先选择谱面音频', en: 'Select chart audio first' },
  position: { zh: '谱面播放位置', en: 'Chart playback position' },
} as const

export const aiChartCopy = {
  title: { zh: 'AI 制谱', en: 'AI charting' },
  description: { zh: '套用完整谱面的音符与节奏设置，保留当前音频、曲名和特效。支持整批撤销。', en: 'Apply a full chart’s notes and timing. Keep current audio, title and effects. Undo an entire batch.' },
  transfer: { zh: '套用完整谱面（无需原上下文）', en: 'Reuse full chart (no source context needed)' },
  position: { zh: '当前位置', en: 'Current position' },
  beat: { zh: '拍', en: 'beat' },
  start: { zh: '导出区间起点（ms）', en: 'Export range start (ms)' },
  end: { zh: '导出区间终点（ms）', en: 'Export range end (ms)' },
  appliedRange: { zh: '本批修改区间（ms）', en: 'Batch range (ms)' },
  export: { zh: '导出 AI 上下文', en: 'Export AI context' },
  import: { zh: '选择 JSON 文件', en: 'Choose JSON file' },
  source: { zh: '谱面 JSON', en: 'Chart JSON' },
  placeholder: { zh: '粘贴原生 chart.json 或完整 AI 谱面 JSON，或选择文件', en: 'Paste native chart.json or full AI chart JSON, or choose a file' },
  validate: { zh: '校验并预览', en: 'Validate and preview' },
  apply: { zh: '应用本批修改', en: 'Apply batch' },
  close: { zh: '关闭', en: 'Close' },
  busy: { zh: '处理中…', en: 'Working…' },
  ready: { zh: '校验通过', en: 'Validation passed' },
  stalePreview: { zh: '谱面已变化，请重新校验。', en: 'The chart changed. Validate again.' },
  applied: { zh: 'AI 修改已应用并保存，可整批撤销', en: 'AI batch applied and saved. You can undo it.' },
  saveFailed: { zh: '修改已应用，但保存失败。请重试保存，可整批撤销。', en: 'Batch applied, but saving failed. Retry saving; the batch can be undone.' },
  noAudio: { zh: '请先在谱面信息中选择用于播放的原始音频。', en: 'First select the original playback audio in Chart Info.' },
  exported: { zh: '已导出 AI 上下文', en: 'AI context exported' },
  failed: { zh: '操作失败，请重试。', en: 'Operation failed. Try again.' },
  issues: { zh: '校验问题', en: 'Validation issues' },
  added: { zh: '新增', en: 'Added' },
  updated: { zh: '修改', en: 'Updated' },
  deleted: { zh: '删除', en: 'Deleted' },
  holds: { zh: '应用后长条', en: 'Holds after import' },
  replace: { zh: '替换整张谱面的音符', en: 'Replace all chart notes' },
  segment: { zh: '替换指定区间内的音符', en: 'Replace notes in the specified range' },
  patch: { zh: '按 ID 修改指定区间', en: 'Edit the specified range by ID' },
  timing: { zh: '应用后 BPM / 第 0 拍（ms）', en: 'BPM / beat zero (ms) after import' },
  errors: {
    transfer: { zh: '套用支持完整 chart.json、replace 或覆盖整首的 segment 文件；局部分段和补丁请取消勾选套用。', en: 'Reuse supports native charts, replace files and whole-song segments. Uncheck reuse for partial segments and patches.' },
    json: { zh: 'JSON 无法解析，请移除 Markdown 围栏、注释和尾逗号。', en: 'Invalid JSON. Remove Markdown fences, comments and trailing commas.' },
    size: { zh: '文件超过 4 MiB，或音符/操作超过 50,000 项，请缩小区间。', en: 'Over 4 MiB or 50,000 notes/operations. Use a smaller range.' },
    schema: { zh: '格式、必填字段或字段名称不符合 v1 协议。', en: 'Invalid format, required field or field name for protocol v1.' },
    number: { zh: '需要合法数值；轨道须为 0–3 的整数，BPM 须为 20–400。', en: 'Invalid number. Lanes must be integers 0–3; BPM must be 20–400.' },
    id: { zh: 'ID 须为 1–128 字符的非空字符串。', en: 'ID must be a nonblank string of 1–128 characters.' },
    duplicate: { zh: '音符 ID 重复，或同一批次多次操作同一 ID。', en: 'Duplicate note ID or repeated operation on the same ID.' },
    bounds: { zh: '时间超出音频范围；不会自动截断或吸附。', en: 'Time is outside the audio. Values are never silently clamped or snapped.' },
    hold: { zh: '长条必须具有晚于起点的终点；单点不能有终点。', en: 'A hold needs an end after its start. A tap cannot have an end.' },
    collision: { zh: '同轨音符重复或与长条重叠；长条尾与下一音符同刻允许。', en: 'Duplicate or overlapping notes in one lane. A note at a hold tail is allowed.' },
    target: { zh: '目标谱面不匹配，请导出当前谱面的上下文。', en: 'Wrong target chart. Export context from the current chart.' },
    stale: { zh: '基线已变化。续改请基于上一版已应用结果；有手动修改时请更新上下文。', en: 'Baseline changed. Continue from the last applied result, or refresh context after manual edits.' },
    audio: { zh: '音频文件名或时长不匹配（容差 1ms），请使用同一份原始音频。', en: 'Audio filename or duration differs (1ms tolerance). Use the identical source audio.' },
    timing: { zh: 'BPM、变速点或偏移不匹配；变速点必须按毫秒严格递增。', en: 'Tempo/offset mismatch. BPM change times must strictly increase in milliseconds.' },
    standalone: { zh: '无 target 的完整谱面只能导入没有音符、特效和变速点的空谱面。', en: 'A standalone chart requires an empty chart with no notes, effects or BPM changes.' },
    range: { zh: '区间无效或修改跨越边界。跨界长条会保留，请扩大区间后修改。', en: 'Invalid range or an edit crosses its boundary. Crossing holds are preserved; use a wider range to edit them.' },
    missing: { zh: '要修改或删除的音符 ID 不存在。', en: 'The note ID to update or delete does not exist.' },
    replayed: { zh: '该请求已应用，请勿重复导入；撤销后可重新应用。', en: 'This request was already applied. Undo it before reapplying.' },
  },
} as const

export interface NavigationItem {
  id: Exclude<RouteId, 'playtest'>
  label: { zh: string; en: string }
  description: { zh: string; en: string }
  icon: LucideIcon
}

export interface NavigationGroup {
  items: NavigationItem[]
}

export const appConfig = {
  name: import.meta.env.VITE_APP_NAME || '织月制谱',
  englishName: englishAppName,
  shortName: '织月制谱',
  eyebrow: 'CHART STUDIO',
  description: import.meta.env.VITE_APP_DESCRIPTION || '织月制谱（Moonweave Chart Editor）——支持桌面与网页的 4K 下落式谱面编辑和游玩工具。',
  navigation: [{
    items: [
      { id: 'manage', label: { zh: '我的谱面', en: 'My Charts' }, description: { zh: '管理内部谱面库', en: 'Manage the local chart library' }, icon: Library },
      { id: 'editor', label: { zh: '编辑器', en: 'Editor' }, description: { zh: '编辑当前谱面', en: 'Edit the current chart' }, icon: Piano },
    ],
  }] satisfies NavigationGroup[],
} as const

export function isRouteId(value: string): value is RouteId {
  return value === 'manage' || value === 'editor' || value === 'playtest'
}

export const playPauseCopy = {
  pause: { zh: '暂停', en: 'Pause' },
  resume: { zh: '继续', en: 'Resume' },
  restart: { zh: '重头开始', en: 'Restart from beginning' },
  leave: { zh: '退出游玩', en: 'Leave play' },
  backToEditor: { zh: '返回编辑器', en: 'Back to editor' },
  openingTrace: { zh: '下载开场诊断', en: 'Download opening trace' },
  preparingAudio: { zh: '正在准备游玩音频…', en: 'Preparing play audio…' },
  audioUnavailable: { zh: '歌曲音频无法加载', en: 'Could not load song audio' },
} as const

export const autoPlayCopy = { zh: '自动演奏', en: 'Auto Play' } as const

export const redZoneCopy = {
  mode: { zh: '红区模式', en: 'Red zones' },
  hit: { zh: '踩中红区', en: 'Red zone' },
} as const
