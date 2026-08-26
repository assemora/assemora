/**
 * One input per field kind (SPEC.md §39, §115).
 *
 * The resource says a field is `richText` or `select` or `media`; this decides what
 * that looks like. Studio adds no validation of its own — the server validates, and
 * a second implementation here would only drift from it (SPEC.md §14).
 */
import { useEffect, useState } from 'react'

import type { FieldDescriptor } from '../api/introspection.ts'
import { Badge, Button, Field, Input, Select, Textarea } from '../ui/index.tsx'
import { MediaPicker } from './media-picker.tsx'

export type FieldInputProps = {
  readonly field: FieldDescriptor
  readonly value: unknown
  readonly errors?: readonly string[]
  onChange(value: unknown): void
}

const asText = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value)

/** A date input wants `2026-08-26`, and a timestamp arrives as an ISO string. */
const asDateInput = (value: unknown, withTime: boolean): string => {
  if (value === null || value === undefined || value === '') return ''

  const date = new Date(String(value))

  if (Number.isNaN(date.getTime())) return ''

  return withTime ? date.toISOString().slice(0, 16) : date.toISOString().slice(0, 10)
}

const MediaInput = ({ value, onChange }: { value: unknown; onChange(value: unknown): void }) => {
  const [picking, setPicking] = useState(false)
  const id = asText(value)

  return (
    <div className="flex items-center gap-2">
      {id === '' ? (
        <span className="text-sm text-ink-faint">Nothing chosen</span>
      ) : (
        <img
          src={`/api/media/by-id/${id}`}
          alt=""
          className="size-12 rounded-lg border border-line object-cover"
        />
      )}

      <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
        {id === '' ? 'Choose…' : 'Replace'}
      </Button>

      {id !== '' && (
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          Clear
        </Button>
      )}

      {picking && (
        <MediaPicker
          onClose={() => setPicking(false)}
          onPick={(picked) => {
            onChange(picked.id)
            setPicking(false)
          }}
        />
      )}
    </div>
  )
}

const JsonInput = ({ value, onChange }: { value: unknown; onChange(value: unknown): void }) => {
  const written = JSON.stringify(value ?? null, null, 2)
  const [text, setText] = useState(written)
  const [broken, setBroken] = useState(false)

  // The value can change under the field — another block selected, a command
  // answering — and the text has to follow it rather than stay where it started.
  // Not while it is being typed into: that is what `broken` and the equality check
  // guard against.
  useEffect(() => {
    setText((current) => {
      try {
        return JSON.stringify(JSON.parse(current)) === JSON.stringify(value ?? null)
          ? current
          : written
      } catch {
        return current
      }
    })
  }, [written, value])

  return (
    <div className="space-y-1">
      <Textarea
        className="font-mono text-xs"
        rows={6}
        value={text}
        onChange={(event) => {
          setText(event.target.value)

          try {
            onChange(JSON.parse(event.target.value))
            setBroken(false)
          } catch {
            setBroken(true)
          }
        }}
      />
      {broken && <span className="text-xs text-danger">Not valid JSON yet</span>}
    </div>
  )
}

const Control = ({ field, value, onChange }: Omit<FieldInputProps, 'errors'>) => {
  switch (field.kind) {
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span className="text-ink-soft">{field.help ?? 'Enabled'}</span>
        </label>
      )

    case 'select':
      return (
        <Select value={asText(value)} onChange={(event) => onChange(event.target.value)}>
          <option value="">—</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )

    case 'number':
      return (
        <Input
          type="number"
          value={asText(value)}
          onChange={(event) =>
            onChange(event.target.value === '' ? null : Number(event.target.value))
          }
        />
      )

    case 'date':
    case 'datetime':
      return (
        <Input
          type={field.kind === 'date' ? 'date' : 'datetime-local'}
          value={asDateInput(value, field.kind === 'datetime')}
          onChange={(event) =>
            onChange(event.target.value === '' ? null : new Date(event.target.value).toISOString())
          }
        />
      )

    case 'richText':
    case 'textarea':
      return (
        <Textarea
          rows={field.kind === 'richText' ? 12 : 4}
          value={asText(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )

    case 'json':
    case 'object':
    case 'array':
      return <JsonInput value={value} onChange={onChange} />

    case 'media':
      return <MediaInput value={value} onChange={onChange} />

    default:
      return (
        <Input
          type={field.kind === 'email' ? 'email' : field.kind === 'url' ? 'url' : 'text'}
          placeholder={field.placeholder}
          value={asText(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )
  }
}

export const FieldInput = ({ field, value, errors, onChange }: FieldInputProps) => (
  <Field
    label={field.label ?? field.name}
    help={
      field.kind === 'slug' && field.source !== undefined
        ? `Left empty, this is made from ${field.source}`
        : field.help
    }
    required={field.required}
    {...(errors === undefined ? {} : { errors })}
  >
    <Control field={field} value={value} onChange={onChange} />
  </Field>
)

export const FieldBadge = ({ field }: { field: FieldDescriptor }) => (
  <Badge tone={field.required ? 'accent' : 'neutral'}>{field.kind}</Badge>
)
