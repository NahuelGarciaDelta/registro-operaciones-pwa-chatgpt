import { useEffect, useMemo, useState } from 'react'

type Props = {
  value: string
  options: string[]
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

export default function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = 'Escribí para buscar…',
  required = false,
  disabled = false,
  emptyText = 'Sin coincidencias'
}: Props) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) setQuery(value)
  }, [value, open])

  const filtered = useMemo(() => {
    const q = normalize(query)
    const source = [...new Set(options.filter(Boolean))]
    if (!q) return source.slice(0, 60)
    return source.filter(option => normalize(option).includes(q)).slice(0, 60)
  }, [options, query])

  const select = (option: string) => {
    setQuery(option)
    setOpen(false)
    onChange(option)
  }

  const finishTyping = () => {
    const exact = options.find(option => normalize(option) === normalize(query))
    if (exact) {
      select(exact)
      return
    }
    setQuery(value)
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
          setQuery(value)
          setOpen(false)
        }
      }}
      onBlur={() => window.setTimeout(finishTyping, 120)}
    />
    {!disabled && <span className="searchChevron" aria-hidden="true">⌄</span>}
    {open && !disabled && <div className="searchDropdown">
      {filtered.length ? filtered.map(option => <button
        key={option}
        type="button"
        className={option === value ? 'searchOption selected' : 'searchOption'}
        onMouseDown={e => e.preventDefault()}
        onClick={() => select(option)}
      >{option}</button>) : <div className="searchEmpty">{emptyText}</div>}
    </div>}
  </div>
}
