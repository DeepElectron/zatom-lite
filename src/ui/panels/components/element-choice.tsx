import { getElement } from "../../../lib/crystal/elements"

export function ElementChoice({
  symbol,
  selected,
  onSelect,
}: {
  symbol: string
  selected: boolean
  onSelect: () => void
}) {
  const color = getElement(symbol)?.color ?? "#888888"

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-selected={selected}
      className="zatom-choice zatom-pressable flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-1.5 text-[11px] font-semibold"
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full border border-black/10"
        style={{ backgroundColor: color }}
      />
      <span>{symbol}</span>
    </button>
  )
}
