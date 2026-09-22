import { useMemo, useState } from 'react'

export type SearchableOption = string | { value: string; label: string }

type Props = {
  value: string
  options: SearchableOption[]
  onChange: (value: string) => void
  placeholder?: string
  displayPlaceholder?: string
  required?: boolean
  disabled?: boolean
  emptyText?: string
}

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('es')
  .trim()

const toOption = (option: SearchableOption) => typeof option === 'string'
  ? { value: option, label: option }
  : option

export default function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = 'Escribí para buscar…',
  displayPlaceholder = 'Seleccionar…',
  required = false,
  disabled = false,
  emptyText = 'Sin coincidencias'
}: Props) {
  const normalizedOptions = useMemo(() => {
    const seen = new Set<string>()
    return options
      .map(toOption)
      .filter(option => option.value && !seen.has(option.value) && seen.add(option.value))
  }, [options])

  const selectedLabel = normalizedOptions.find(option => option.value === value)?.label || value
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = normalize(query)
    if (!q) return normalizedOptions.slice(0, 60)
    return normalizedOptions
      .filter(option => normalize(option.label).includes(q) || normalize(option.value).includes(q))
      .slice(0, 60)
  }, [normalizedOptions, query])

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  const select = (option: { value: string; label: string }) => {
    onChange(option.value)
    close()
  }

  const toggle = () => {
    if (disabled) return
    setQuery('')
    setOpen(v => !v)
  }

  return <div className="searchSelect">
    <button
      type="button"
      className={value ? 'searchSelectTrigger hasValue' : 'searchSelectTrigger'}
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-required={required}
      onClick={toggle}
      onKeyDown={e => {
        if ((e.key === 'Enter' || e.key === ' ') && !open) {
          e.preventDefault()
          setQuery('')
          setOpen(true)
        }
        if (e.key === 'Escape') close()
      }}
    >
      <span>{selectedLabel || displayPlaceholder}</span>
      <span className="searchChevron" aria-hidden="true">⌄</span>
    </button>

    {open && !disabled && <div className="searchDropdown" role="listbox">
      <div className="searchBoxWrap">
        <span className="searchIcon" aria-hidden="true">⌕</span>
        <input
          className="searchInput"
          type="text"
          value={query}
          autoFocus
          autoComplete="off"
          placeholder={placeholder}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (filtered.length) select(filtered[0])
            }
            if (e.key === 'Escape') close()
          }}
          onBlur={() => window.setTimeout(close, 140)}
        />
      </div>

      <div className="searchOptions">
        {filtered.length ? filtered.map(option => <button
          key={option.value}
          type="button"
          className={option.value === value ? 'searchOption selected' : 'searchOption'}
          onMouseDown={e => e.preventDefault()}
          onClick={() => select(option)}
        >{option.label}</button>) : <div className="searchEmpty">{emptyText}</div>}
      </div>
    </div>}
  </div>
}
