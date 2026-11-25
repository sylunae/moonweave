import type { ComponentProps } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

interface GameSelectProps extends ComponentProps<typeof Select> {
  label: string
  className?: string
  options: ReadonlyArray<readonly [value: string, label: string]>
}

export function GameSelect({ label, className = '', options, ...props }: GameSelectProps) {
  return <Select {...props}>
    <SelectTrigger className={`game-select ${className}`} aria-label={label}><SelectValue /></SelectTrigger>
    <SelectContent position="popper" align="start" sideOffset={4} className="game-select-menu">
      {options.map(([value, title]) => <SelectItem key={value} value={value}>{title}</SelectItem>)}
    </SelectContent>
  </Select>
}
