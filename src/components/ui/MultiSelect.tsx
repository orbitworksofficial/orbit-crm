'use client';

import { useState, useRef, useEffect, useId } from 'react';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * Checkbox-list multi-select used for service interest tags on contacts and
 * deals (brief §02, §03).
 *
 * Renders the selection as hidden inputs sharing one `name`, so it works inside
 * a plain form post to a server action — no client-side form library needed.
 */
export function MultiSelect({
  name,
  label,
  options,
  defaultSelected = [],
  placeholder = 'Select…',
  hint,
}: {
  name: string;
  label?: string;
  options: MultiSelectOption[];
  defaultSelected?: string[];
  placeholder?: string;
  hint?: string;
}) {
  const [selected, setSelected] = useState<string[]>(defaultSelected);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function toggle(value: string) {
    setSelected((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
  }

  const selectedLabels = options
    .filter((option) => selected.includes(option.value))
    .map((option) => option.label);

  return (
    <div className="flex flex-col gap-1.5" ref={containerRef}>
      {label && (
        <span className="text-sm font-medium text-[var(--text-secondary)]">{label}</span>
      )}

      {/* Submitted values. */}
      {selected.map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          className={cn(
            'w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)]',
            'px-3 min-h-10 py-1.5 text-sm text-left flex items-center justify-between gap-2',
            'hover:bg-[var(--surface-sunken)] transition-colors',
          )}
        >
          <span
            className={cn(
              'truncate',
              selectedLabels.length === 0 && 'text-[var(--text-muted)]',
            )}
          >
            {selectedLabels.length === 0
              ? placeholder
              : selectedLabels.length <= 2
                ? selectedLabels.join(', ')
                : `${selectedLabels.length} selected`}
          </span>
          <span aria-hidden="true" className="text-[var(--text-muted)] text-xs shrink-0">
            ▼
          </span>
        </button>

        {open && (
          <div
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
            className={cn(
              'absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-lg shadow-lg',
              'border border-[var(--border-strong)] bg-[var(--surface-overlay)] p-1',
            )}
          >
            {options.length === 0 ? (
              <p className="px-3 py-2 text-sm text-[var(--text-muted)]">No options available</p>
            ) : (
              options.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <label
                    key={option.value}
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      'flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer text-sm',
                      'hover:bg-[var(--surface-sunken)] transition-colors',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(option.value)}
                      className="size-4 rounded accent-[var(--primary)] cursor-pointer"
                    />
                    <span className="text-[var(--text-primary)]">{option.label}</span>
                  </label>
                );
              })
            )}
          </div>
        )}
      </div>

      {hint && <p className="text-xs text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}
