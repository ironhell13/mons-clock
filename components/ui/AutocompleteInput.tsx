'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface AutocompleteOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface AutocompleteInputProps {
  options: AutocompleteOption[];
  value: string;
  onChange: (value: string, option?: AutocompleteOption) => void;
  placeholder?: string;
  allowFreeText?: boolean;
  uppercase?: boolean;
  disabled?: boolean;
  className?: string;
  inputId?: string;
  badgeForFreeText?: string;
}

export function AutocompleteInput({
  options,
  value,
  onChange,
  placeholder = 'Ketik untuk mencari...',
  allowFreeText = false,
  uppercase = false,
  disabled = false,
  className = '',
  inputId,
  badgeForFreeText,
}: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 60);
    return options
      .filter(
        (opt) =>
          opt.label.toLowerCase().includes(q) ||
          opt.value.toLowerCase().includes(q) ||
          (opt.sublabel && opt.sublabel.toLowerCase().includes(q))
      )
      .slice(0, 60);
  }, [options, query]);

  const exactMatchExists = useMemo(() => {
    const norm = query.trim().toLowerCase();
    if (!norm) return true;
    return options.some(
      (opt) => opt.label.toLowerCase() === norm || opt.value.toLowerCase() === norm
    );
  }, [options, query]);

  const handleInputChange = (raw: string) => {
    const next = uppercase ? raw.toUpperCase() : raw;
    setQuery(next);
    setOpen(true);
    if (allowFreeText) {
      onChange(next);
    } else {
      const matched = options.find(
        (opt) => opt.label.toLowerCase() === next.trim().toLowerCase()
      );
      if (matched) {
        onChange(matched.value, matched);
      } else if (!next.trim()) {
        onChange('');
      }
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          id={inputId}
          type="text"
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full rounded-xl border border-border-sky bg-white pl-10 pr-10 py-3 text-sm text-ink placeholder:text-ink-muted/60 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:bg-page/70 transition"
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => setOpen((p) => !p)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-muted hover:text-ink"
          aria-label="Toggle daftar pilihan"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {allowFreeText && badgeForFreeText && query.trim().length > 0 && !exactMatchExists && (
        <span className="mt-1.5 inline-flex items-center rounded-lg bg-warning/15 border border-warning/30 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          {badgeForFreeText}
        </span>
      )}

      {open && !disabled && (
        <div className="absolute z-40 mt-1.5 w-full max-h-60 overflow-y-auto rounded-xl border border-border-sky bg-white shadow-card py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-xs text-ink-muted">
              {allowFreeText
                ? 'Tidak ada di master, teks yang diketik tetap dapat digunakan.'
                : 'Data tidak ditemukan di master.'}
            </div>
          ) : (
            filtered.map((opt) => {
              const selected = opt.value === value || opt.label === query;
              return (
                <button
                  key={`${opt.value}-${opt.label}`}
                  type="button"
                  onClick={() => {
                    setQuery(opt.label);
                    onChange(opt.value, opt);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between gap-2 hover:bg-page transition ${
                    selected ? 'bg-primary-50 font-semibold text-primary-700' : 'text-ink'
                  }`}
                >
                  <div>
                    <div>{opt.label}</div>
                    {opt.sublabel && (
                      <div className="text-xs text-ink-muted font-normal">{opt.sublabel}</div>
                    )}
                  </div>
                  {selected && <Check className="w-4 h-4 text-primary-600 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

