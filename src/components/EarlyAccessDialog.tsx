import { useState } from 'react'
import { useI18n } from '@/app/i18n'
import { usePreferences } from '@/app/preferences'
import { earlyAccessCopy as copy } from '@/config/app'
import { Button } from './ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

const languages = [
  { value: 'zh', label: '中文', lang: 'zh-CN' },
  { value: 'en', label: 'English', lang: 'en' },
] as const

export function EarlyAccessDialog() {
  const [open, setOpen] = useState(true)
  const { language } = useI18n()
  const { setPreferences } = usePreferences()

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent
      className="early-access-dialog flex flex-col overflow-y-auto"
      data-scroll-region
      showCloseButton={false}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDownOutside={(event) => event.preventDefault()}
    >
      <DialogHeader className="gap-3">
        <DialogTitle className="text-lg leading-snug">{copy.title[language]}</DialogTitle>
        <div role="group" aria-label={copy.language[language]} className="flex flex-wrap gap-2">
          {languages.map(({ value, label, lang }) => <Button
            key={value}
            type="button"
            lang={lang}
            size="lg"
            variant={language === value ? 'secondary' : 'outline'}
            aria-pressed={language === value}
            onClick={() => setPreferences((current) => ({ ...current, language: value }))}
          >{label}</Button>)}
        </div>
      </DialogHeader>
      <DialogDescription asChild>
        <div className="flex flex-col gap-2 leading-relaxed">
          <p>{copy.description[language]}</p>
          <p>
            {copy.follow[language]}{' '}
            <a className="font-medium text-foreground underline underline-offset-3" href={copy.instagram.url} target="_blank" rel="noopener noreferrer">
              {copy.instagram.handle}
            </a>
            {language === 'zh' ? '。' : '.'}
          </p>
        </div>
      </DialogDescription>
      <DialogFooter>
        <DialogClose asChild><Button size="lg">{copy.continue[language]}</Button></DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
