import { ChevronDown, FolderOpen, Languages, Settings } from 'lucide-react'
import { appConfig } from '@/config/app'
import { useI18n } from '@/app/i18n'
import { navigate } from '@/app/navigation'
import { BrandMark } from './BrandMark'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from './ui/dropdown-menu'
import { GameButton } from './ui/game-controls'

export function PlayerMenu({ onSettings, onStorage }: { onSettings(): void; onStorage(): void }) {
  const { text, language, toggleLanguage } = useI18n()
  return <DropdownMenu><DropdownMenuTrigger asChild><GameButton className="player-menu" aria-label={text('玩家菜单', 'Player menu')}><BrandMark small /><span>{text('本地玩家', 'Local player')}</span><ChevronDown /></GameButton></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {appConfig.navigation.flatMap(g => g.items).map(({ id, icon: Icon, label }) => <DropdownMenuItem key={id} onSelect={() => navigate(id)}><Icon />{label[language]}</DropdownMenuItem>)}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onStorage}><FolderOpen />{text('存储位置', 'Storage location')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={toggleLanguage}><Languages />{text('English', '简体中文')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={onSettings}><Settings />{text('设置', 'Settings')}</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>
}
