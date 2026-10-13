import { LayoutGridIcon, SettingsIcon, Wand2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ToolbarProps {
  mode: 'view' | 'edit'
  onModeChange: (mode: 'view' | 'edit') => void
  onlineCount: number
  totalCount: number
  /** Re-lay the tiles onto a grid. */
  onAutoArrange: () => void
  onOpenSettings: () => void
}

/**
 * Top control bar: watch/edit toggle, auto-arrange and settings.
 *
 * Everything lives here instead of a config file, so the operator never leaves
 * the page to add a camera or move tiles around.
 */
export function Toolbar({
  mode,
  onModeChange,
  onlineCount,
  totalCount,
  onAutoArrange,
  onOpenSettings,
}: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="inline-flex rounded-lg border p-0.5"
        role="tablist"
        aria-label="Режим стены"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'view'}
          onClick={() => onModeChange('view')}
          className={cn(
            'rounded-md px-2.5 py-1 text-sm font-medium transition-colors',
            mode === 'view' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Просмотр
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'edit'}
          onClick={() => onModeChange('edit')}
          className={cn(
            'rounded-md px-2.5 py-1 text-sm font-medium transition-colors',
            mode === 'edit' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Раскладка
        </button>
      </div>

      {mode === 'edit' && totalCount > 0 && (
        <Button variant="outline" size="sm" onClick={onAutoArrange}>
          <Wand2Icon data-icon="inline-start" />
          Прибрать
        </Button>
      )}

      <Button variant="outline" size="sm" onClick={onOpenSettings}>
        <SettingsIcon data-icon="inline-start" />
        Настройки
      </Button>

      {totalCount > 0 && (
        <Badge variant="secondary" className="ml-auto">
          <LayoutGridIcon className="size-3.5" aria-hidden="true" />
          Онлайн {onlineCount} из {totalCount}
        </Badge>
      )}
    </div>
  )
}
