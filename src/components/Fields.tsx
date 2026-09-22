import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { isTokenId } from '../core/project';

export function TokenIdField({ label, value, fallback, duplicate, onChange, report, fieldKey }: { label: string; value?: string; fallback: string; duplicate: boolean; onChange: (value?: string) => void; report: (key: string, invalid: boolean) => void; fieldKey: string }) {
  const [raw, setRaw] = useState(value ?? '');
  const id = useId();
  const invalid = raw !== '' && !isTokenId(raw);
  return <><input aria-label={label} value={raw} placeholder={fallback} maxLength={78} inputMode="numeric" aria-invalid={invalid || duplicate} aria-describedby={invalid || duplicate ? id : undefined} onChange={event => {
    const next = event.target.value; setRaw(next);
    const bad = next !== '' && !isTokenId(next); report(fieldKey, bad);
    if (!bad) onChange(next === '' ? undefined : next);
  }} />{(invalid || duplicate) && <span id={id} className="token-id-error">{invalid ? 'Enter a decimal uint256 ID.' : 'Duplicate effective ID.'}</span>}</>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function NumberField({ label, value, onChange, min = 0, max, step = 1, report, fieldKey }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; report: (key: string, invalid: boolean) => void; fieldKey: string }) {
  const [raw, setRaw] = useState(String(value));
  const id = useId();
  const invalid = raw.trim() === '' || !Number.isFinite(Number(raw)) || Number(raw) < min || (max !== undefined && Number(raw) > max) || (step === 1 && !Number.isSafeInteger(Number(raw)));
  return <label className="field"><span>{label}</span><input type="number" value={raw} min={min} max={max} step={step} aria-invalid={invalid} aria-describedby={invalid ? id : undefined} onChange={e => {
    const next = e.target.value;
    setRaw(next);
    const n = Number(next);
    const bad = next.trim() === '' || !Number.isFinite(n) || n < min || (max !== undefined && n > max) || (step === 1 && !Number.isSafeInteger(n));
    report(fieldKey, bad);
    if (!bad) onChange(n);
  }} />{invalid && <small className="error" id={id}>Enter {step === 1 ? 'a whole number' : 'a number'} from {min}{max === undefined ? ' or greater' : ` to ${max}`}.</small>}</label>;
}

export function Choices<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; description?: string }[]; onChange: (value: T) => void }) {
  const name = useId();
  return <fieldset className="choices"><legend>{label}</legend>{options.map(option => <label key={option.value}><input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} /><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>)}</fieldset>;
}
