import { useState, type FocusEvent, type KeyboardEvent } from 'react';

interface ExistingTextFieldProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  className: string;
  placeholder?: string;
  required?: boolean;
  type?: React.HTMLInputTypeAttribute;
  rows?: number;
}

export default function ExistingTextField({
  value,
  onChange,
  suggestions,
  className,
  placeholder,
  required,
  type = 'text',
  rows,
}: ExistingTextFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const search = value.trim().toLocaleLowerCase();
  const matches = suggestions
    .filter((suggestion) => {
      const normalized = suggestion.trim();
      return normalized && normalized.toLocaleLowerCase().startsWith(search)
        && normalized.toLocaleLowerCase() !== search;
    })
    .slice(0, 8);

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsOpen(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Escape') setIsOpen(false);
  };

  const sharedProps = {
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(event.target.value);
      setIsOpen(true);
    },
    onFocus: () => setIsOpen(true),
    onKeyDown: handleKeyDown,
    className,
    placeholder,
    required,
    autoComplete: 'off' as const,
    'aria-autocomplete': 'list' as const,
    'aria-expanded': isOpen && matches.length > 0,
  };

  return (
    <div className="relative" onBlur={handleBlur}>
      {rows ? (
        <textarea {...sharedProps} rows={rows} />
      ) : (
        <input {...sharedProps} type={type} />
      )}
      {isOpen && matches.length > 0 && (
        <div
          role="listbox"
          className="absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-slate-800 bg-slate-900 py-1 shadow-lg"
        >
          {matches.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              role="option"
              aria-selected="false"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(suggestion);
                setIsOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-blue-950/40 focus:bg-blue-950/40 focus:outline-none"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
