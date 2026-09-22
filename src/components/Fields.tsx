import { cloneElement, isValidElement, useId, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { isTokenId } from '../core/project';
import { Popover } from './Popover';
import '../styles/field-help.css';

export function FieldHelp({ label, children }: { label: string; children: ReactNode }) {
  return <Popover label={`About ${label}`} trigger="?" title={label} triggerClassName="field-help-trigger" className="field-help-content"><div>{children}</div></Popover>;
}

export function TokenIdField({ label, value, fallback, duplicate, onChange, report, fieldKey, path }: { label: string; value?: string; fallback: string; duplicate: boolean; onChange: (value?: string) => void; report: (key: string, invalid: boolean) => void; fieldKey: string; path?: string }) {
  const [raw, setRaw] = useState(value ?? '');
  const id = useId();
  const invalid = raw !== '' && !isTokenId(raw);
  return <><input aria-label={label} data-field-path={path} data-field-key={fieldKey} value={raw} placeholder={fallback} maxLength={78} inputMode="numeric" aria-invalid={invalid || duplicate} aria-describedby={invalid || duplicate ? id : undefined} onChange={event => {
    const next = event.target.value; setRaw(next);
    const bad = next !== '' && !isTokenId(next); report(fieldKey, bad);
    if (!bad) onChange(next === '' ? undefined : next);
  }} />{(invalid || duplicate) && <span id={id} className="token-id-error">{invalid ? 'Enter a decimal uint256 ID.' : 'Duplicate effective ID.'}</span>}</>;
}

export function Field({ label, children, hint, help, path }: { label: string; children: ReactNode; hint?: string; help?: ReactNode; path?: string }) {
  const id = useId();
  const control = isValidElement(children) ? cloneElement(children as ReactElement<{ id?: string; 'data-field-path'?: string; 'aria-describedby'?: string }>, { id, 'data-field-path': path, ...(hint ? { 'aria-describedby': `${id}-hint` } : {}) }) : children;
  return <div className="field"><div className="field-heading"><label htmlFor={id}>{label}</label>{help && <FieldHelp label={label}>{help}</FieldHelp>}</div>{control}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}

export function NumberField({ label, value, onChange, min = 0, max, step = 1, report, fieldKey, help, path }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; report: (key: string, invalid: boolean) => void; fieldKey: string; help?: ReactNode; path?: string }) {
  const [raw, setRaw] = useState(String(value));
  const id = useId();
  const invalid = raw.trim() === '' || !Number.isFinite(Number(raw)) || Number(raw) < min || (max !== undefined && Number(raw) > max) || (step === 1 && !Number.isSafeInteger(Number(raw)));
  return <div className="field"><div className="field-heading"><label htmlFor={id}>{label}</label>{help && <FieldHelp label={label}>{help}</FieldHelp>}</div><input id={id} data-field-path={path} data-field-key={fieldKey} type="number" value={raw} min={min} max={max} step={step} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} onChange={e => {
    const next = e.target.value;
    setRaw(next);
    const n = Number(next);
    const bad = next.trim() === '' || !Number.isFinite(n) || n < min || (max !== undefined && n > max) || (step === 1 && !Number.isSafeInteger(n));
    report(fieldKey, bad);
    if (!bad) onChange(n);
  }} />{invalid && <small className="error" id={`${id}-error`}>Enter {step === 1 ? 'a whole number' : 'a number'} from {min}{max === undefined ? ' or greater' : ` to ${max}`}.</small>}</div>;
}

export function Choices<T extends string>({ label, value, options, onChange, help, path }: { label: string; value: T; options: { value: T; label: string; description?: string }[]; onChange: (value: T) => void; help?: ReactNode; path?: string }) {
  const name = useId();
  return <fieldset className="choices"><legend><span className="field-heading">{label}{help && <FieldHelp label={label}>{help}</FieldHelp>}</span></legend>{options.map(option => <label key={option.value}><input type="radio" name={name} data-field-path={path} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} /><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>)}</fieldset>;
}
