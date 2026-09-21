import { useEffect, useMemo, useState } from 'react'

export type SearchableOption = string | { value: string; label: string }

type Props = {
  value: string
  options: SearchableOption[]
  onChange: (value: string) => void
  placeholder?: string
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
  const [query, setQuery] = useState(selectedLabel)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) setQuery(selectedLabel)
  }, [selectedLabel, open])

  const filtered = useMemo(() => {
    const q = normalize(query)
    if (!q) return normalizedOptions.slice(0, 60)
    return normalizedOptions
      .filter(option => normalize(option.label).includes(q) || normalize(option.value).includes(q))
      .slice(0, 60)
  }, [normalizedOptions, query])

  const select = (option: { value: string; label: string }) => {
    setQuery(option.label)
    setOpen(false)
    onChange(option.value)
  }

  const finishTyping = () => {
    const exact = normalizedOptions.find(option =>
      normalize(option.label) === normalize(query) || normalize(option.value) === normalize(query)
    )
    if (exact) {
      select(exact)
      return
    }
    setQuery(selectedLabel)
    setOpen(false)
  }

  return <div className="searchSelect">
    <input
      type="text"
      value={query}
      required={required}
      disabled={disabled}
      autoComplete="off"
      placeholder={placeholder}
      aria-expanded={open}
      onFocus={() => !disabled && setOpen(true)}
      onChange={e => {
        setQuery(e.target.value)
        setOpen(true)
        if (value) onChange('')
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          if (filtered.length) select(filtered[0])
        }
        if (e.key === 'Escape') {
          setQuery(selectedLabel)
          setOpen(false)
        }
      }}
      onBlur={() => window.setTimeout(finishTyping, 120)}
    />
    {!disabled && <span className="searchChevron" aria-hidden="true">⌄</span>}
    {open && !disabled && <div className="searchDropdown">
      {filtered.length ? filtered.map(option => <button
        key={option.value}
        type="button"
        className={option.value === value ? 'searchOption selected' : 'searchOption'}
        onMouseDown={e => e.preventDefault()}
        onClick={() => select(option)}
      >{option.label}</button>) : <div className="searchEmpty">{emptyText}</div>}
    </div>}
  </div>
}
