import { useI18n } from '@/app/i18n'
import { isTouchWeb } from '@/app/mobileBack'
import { Input } from '@/components/ui/input'
import { tiers } from './libraryMetadata'

export function DifficultyLevelFields({ levels, focusTier, onCommit }: {
  levels: number[]
  focusTier?: number
  onCommit?(tier: number, level: number): void
}) {
  const { text } = useI18n()
  return <fieldset className="wide">
    <legend>{text('难度等级', 'Difficulty levels')}</legend>
    <div className="level-inputs">{tiers.map((name, index) => <label key={name}>{name}
      <Input key={levels[index]} name={`level-${index}`} type="number" min={1} max={99} step={1} defaultValue={levels[index] || ''} placeholder="—"
        autoFocus={focusTier === index && !isTouchWeb()} required={levels[index] > 0} onBlur={onCommit && (event => {
          const input = event.currentTarget
          if (!input.validity.valid) input.value = String(levels[index] || '')
          if (input.value) onCommit(index, input.valueAsNumber)
        })} />
    </label>)}</div>
  </fieldset>
}
