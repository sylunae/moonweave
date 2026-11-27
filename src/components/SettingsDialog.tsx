import { Gamepad2, Info, Laptop, Moon, Palette, RotateCcw, Settings, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '@/app/i18n'
import { usePreferences, type ThemeMode, type TimingWindow } from '@/app/preferences'
import { appConfig, playSettingsCopy, settingsCopy } from '@/config/app'
import { ParticleAppearanceSettings } from '@/features/appearance/ParticleAppearanceSettings'
import { usePlaytestViewport } from '@/features/playtest/usePlaytestViewport'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'
import { ThemePaletteEditor } from './ThemePaletteEditor'

type SettingsSection = 'appearance' | 'play' | 'about'

function PlaySettingSlider({ label, description, min, max, step, value, unit, onCommit }: {
  label: string
  description: string
  min: number
  max: number
  step?: number
  value: number
  unit?: string
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  useEffect(() => setDraft(null), [value])
  const displayedValue = draft ?? value
  return <label className="slider-setting">
    <span><strong>{label}</strong><small>{description}</small></span>
    <div>
      <Slider aria-label={label} min={min} max={max} step={step} value={[displayedValue]}
        onValueChange={([next]) => setDraft(next)} onValueCommit={([next]) => onCommit(next)}
        onPointerCancel={() => setDraft(null)} />
      <output>{displayedValue}{unit}</output>
    </div>
  </label>
}

export function SettingsDialog({ open, onOpenChange, initialSection = 'appearance', onCloseAutoFocus }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSection?: SettingsSection
  onCloseAutoFocus?: (event: Event) => void
}) {
  const [section, setSection] = useState(initialSection)
  const { preferences, setPreferences, resetPreferences } = usePreferences()
  const { text } = useI18n()
  const { portrait, canChooseTrackMode } = usePlaytestViewport()
  const trackModeLabel = text(playSettingsCopy.trackMode.zh, playSettingsCopy.trackMode.en)
  const trackBackgroundDimmingLabel = text(playSettingsCopy.trackBackgroundDimming.zh, playSettingsCopy.trackBackgroundDimming.en)
  const judgmentDisplayLabel = text(playSettingsCopy.judgmentDisplay.zh, playSettingsCopy.judgmentDisplay.en)
  const themeOptions: Array<{ value: ThemeMode; label: string; icon: typeof Laptop }> = [
    { value: 'system', label: text('跟随系统', 'System'), icon: Laptop },
    { value: 'light', label: text('浅色', 'Light'), icon: Sun },
    { value: 'dark', label: text('深色', 'Dark'), icon: Moon },
  ]
  const timingOptions: Array<{ value: TimingWindow; label: string }> = [
    { value: 'strict', label: text('严格', 'Strict') }, { value: 'standard', label: text('标准', 'Standard') }, { value: 'relaxed', label: text('宽松', 'Relaxed') },
  ]

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent size="xl" mobileSize="fullscreen" className="settings-modal" onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader className="sr-only"><DialogTitle>{text(settingsCopy.title.zh, settingsCopy.title.en)}</DialogTitle><DialogDescription>{text('调整 Moonweave 的外观、谱面游玩与个人偏好。', 'Customize Moonweave’s appearance, chart play, and personal preferences.')}</DialogDescription></DialogHeader>
      <div className="settings-layout">
        <aside className="settings-nav">
          <div className="settings-brand"><span><Settings size={18} /></span><div><strong>{text(settingsCopy.title.zh, settingsCopy.title.en)}</strong><small>{text('定制 Moonweave', 'Customize Moonweave')}</small></div></div>
          <nav aria-label={text('设置导航', 'Settings navigation')}>
            <button className={section === 'appearance' ? 'active' : ''} onClick={() => setSection('appearance')}><Palette size={17} />{text('外观', 'Appearance')}</button>
            <button className={section === 'play' ? 'active' : ''} onClick={() => setSection('play')}><Gamepad2 size={17} />{text('谱面游玩', 'Chart Play')}</button>
            <button className={section === 'about' ? 'active' : ''} onClick={() => setSection('about')}><Info size={17} />{text('关于', 'About')}</button>
          </nav>
          <div className="settings-nav-footer"><span>{preferences.language === 'zh' ? appConfig.shortName : appConfig.englishName}</span><small>{appConfig.eyebrow}</small></div>
        </aside>
        <main className="settings-content" data-scroll-region>
          {section === 'appearance' ? <>
            <header className="settings-content-header"><span className="eyebrow">APPEARANCE</span><h2>{text('外观', 'Appearance')}</h2><p>{text('这些设置会在 Web 与桌面端之间保持相同的视觉行为。', 'These settings keep the same visual behavior on the web and desktop apps.')}</p></header>
            <section className="settings-pane"><div className="settings-title"><span><Palette size={18} /></span><div><h3>{text('页面主题', 'Theme')}</h3><p>{text('使用系统主题，或固定为浅色与深色。', 'Follow the system theme or use a fixed light or dark theme.')}</p></div></div><div className="theme-options">{themeOptions.map(({ value, label, icon: Icon }) => <button key={value} className={preferences.theme === value ? 'active' : ''} onClick={() => setPreferences((current) => ({ ...current, theme: value }))}><Icon size={20} /><span>{label}</span></button>)}</div></section>
            <ParticleAppearanceSettings />
            <ThemePaletteEditor />
            <section className="settings-pane setting-row"><div><strong>{text('减少动态效果', 'Reduce motion')}</strong><p>{text('关闭非必要动效，仍保留必要的状态反馈。', 'Disable nonessential animation while preserving useful state feedback.')}</p></div><Switch checked={preferences.reduceMotion} onCheckedChange={(checked) => setPreferences((current) => ({ ...current, reduceMotion: checked }))} aria-label={text('减少动态效果', 'Reduce motion')} /></section>
            <Button variant="outline" onClick={resetPreferences}><RotateCcw />{text('恢复默认设置', 'Restore defaults')}</Button>
          </> : section === 'play' ? <>
            <header className="settings-content-header"><span className="eyebrow">CHART PLAY</span><h2>{text('谱面游玩', 'Chart Play')}</h2><p>{text('这些个人偏好会用于所有谱面，不会随谱面文件导入或导出。', 'These preferences apply to every chart and are not imported or exported with chart files.')}</p></header>
            <section className="settings-pane play-settings-pane">
              <div className="settings-title"><span><Gamepad2 size={18} /></span><div><h3>{text('按键设置', 'Key bindings')}</h3><p>{text('设置四条轨道在试玩时使用的按键。', 'Choose the keys used for the four lanes during playtesting.')}</p></div></div>
              <div className="key-inputs">{preferences.playKeys.map((key, index) => <Input key={index} value={key} maxLength={1} aria-label={text(`轨道 ${index + 1} 按键`, `Lane ${index + 1} key`)} onChange={(event) => { const playKeys = [...preferences.playKeys]; playKeys[index] = event.target.value.slice(-1).toUpperCase(); setPreferences((current) => ({ ...current, playKeys })) }} />)}</div>
              <PlaySettingSlider label={text('音符下落速度', 'Note scroll speed')} description={text('控制游玩时音符的视觉速度', 'Controls the visual speed of notes during play')}
                min={4} max={12} step={.5} value={preferences.noteScrollSpeed} onCommit={(noteScrollSpeed) => setPreferences((current) => ({ ...current, noteScrollSpeed }))} />
              {canChooseTrackMode && <div className="config-block">
                <span>{trackModeLabel}</span>
                <Select value={preferences.trackMode} onValueChange={(trackMode) => {
                  if (trackMode === 'tilted' || trackMode === 'vertical') setPreferences((current) => ({ ...current, trackMode }))
                }}>
                  <SelectTrigger aria-label={trackModeLabel}><SelectValue /></SelectTrigger>
                  <SelectContent position="popper" align="start">
                    <SelectItem value="tilted">{text(playSettingsCopy.tiltedTrack.zh, playSettingsCopy.tiltedTrack.en)}</SelectItem>
                    <SelectItem value="vertical">{text(playSettingsCopy.verticalTrack.zh, playSettingsCopy.verticalTrack.en)}</SelectItem>
                  </SelectContent>
                </Select>
              </div>}
              {!portrait && (!canChooseTrackMode || preferences.trackMode === 'tilted') &&
                <PlaySettingSlider label={text('轨道倾斜度', 'Lane tilt')} description={text('只改变透视，不影响判定', 'Changes perspective without affecting judgment')}
                  min={1} max={45} value={Math.max(1, preferences.laneTilt)} unit="°" onCommit={(laneTilt) => setPreferences((current) => ({ ...current, laneTilt }))} />}
              <div className="config-block"><span>{text('判定宽松度', 'Timing window')}</span><div className="moon-segmented">{timingOptions.map(({ value, label }) => <button key={value} className={preferences.timingWindow === value ? 'active' : ''} onClick={() => setPreferences((current) => ({ ...current, timingWindow: value }))}>{label}</button>)}</div></div>
              <div className="config-block">
                <span>{judgmentDisplayLabel}</span>
                <Select value={preferences.judgmentDisplay} onValueChange={(judgmentDisplay) => {
                  if (judgmentDisplay === 'lane' || judgmentDisplay === 'center') {
                    setPreferences((current) => ({ ...current, judgmentDisplay }))
                  }
                }}>
                  <SelectTrigger aria-label={judgmentDisplayLabel}><SelectValue /></SelectTrigger>
                  <SelectContent position="popper" align="start">
                    <SelectItem value="lane">{text(playSettingsCopy.judgmentLane.zh, playSettingsCopy.judgmentLane.en)}</SelectItem>
                    <SelectItem value="center">{text(playSettingsCopy.judgmentCenter.zh, playSettingsCopy.judgmentCenter.en)}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </section>
            <section className="settings-pane setting-row">
              <strong>{trackBackgroundDimmingLabel}</strong>
              <Switch
                aria-label={trackBackgroundDimmingLabel}
                checked={preferences.trackBackgroundBlur}
                onCheckedChange={(trackBackgroundBlur) => setPreferences((current) => ({ ...current, trackBackgroundBlur }))}
              />
            </section>
            <Button variant="outline" onClick={resetPreferences}><RotateCcw />{text('恢复默认设置', 'Restore defaults')}</Button>
          </> : <>
            <header className="settings-content-header"><span className="eyebrow">ABOUT</span><h2>{text('关于 Moonweave', 'About Moonweave')}</h2><p>{text('面向 4K 下落式节奏谱面的桌面制谱工具。', 'A desktop chart editor for 4K vertical-scrolling rhythm games.')}</p></header>
            <section className="settings-pane about-grid"><div><span>{text('运行环境', 'Environment')}</span><strong>{window.sylunae ? text('Electron 桌面端', 'Electron desktop') : text('Web 浏览器', 'Web browser')}</strong></div><div><span>{text('应用版本', 'App version')}</span><strong>0.1.0</strong></div><div><span>{text('渲染引擎', 'Rendering engine')}</span><strong>{window.sylunae ? `Chromium ${window.sylunae.versions.chrome}` : text('当前浏览器', 'Current browser')}</strong></div><div><span>{text('设计系统', 'Design system')}</span><strong>shadcn/ui + Tailwind CSS</strong></div></section>
          </>}
        </main>
      </div>
    </DialogContent>
  </Dialog>
}
