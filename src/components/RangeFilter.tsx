export type RangeDays = 7 | 30

interface RangeFilterProps {
  range: RangeDays
  onChange: (range: RangeDays) => void
}

export function RangeFilter({ range, onChange }: RangeFilterProps) {
  const options: { value: RangeDays; label: string }[] = [
    { value: 7, label: '7 days' },
    { value: 30, label: '30 days' },
  ]
  return (
    <div className="range-filter" role="group" aria-label="Date range">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={range === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}