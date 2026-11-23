import { useId, useState, useEffect } from 'react';
import { getCustomLocations } from '../lib/pocketbaseServices';

export type LocationType = 'S' | 'ES' | 'R' | 'PID' | 'CUSTOM' | 'NONE' | null;

export interface LocationData {
  type: LocationType;
  number?: string;
  place?: string;
  pid?: string;
}

interface LocationBuilderProps {
  value: LocationData;
  onChange: (data: LocationData) => void;
  numberSuggestions?: string[];
  placeSuggestions?: string[];
  pidSuggestions?: string[];
}

const LOCATION_TYPES = [
  { value: 'S' as const, label: 'Schrank (S)' },
  { value: 'ES' as const, label: 'Elektroschrank (ES)' },
  { value: 'R' as const, label: 'Regal (R)' },
  { value: 'PID' as const, label: 'Paletten-ID (PID)' },
  { value: 'CUSTOM' as const, label: 'Benutzerdefiniert' },
  { value: 'NONE' as const, label: 'Kein Lagerort' },
];

export function generateLocationCode(data: LocationData): string {
  if (!data.type) return '';
  
  if (data.type === 'S' || data.type === 'ES' || data.type === 'R') {
    const num = data.number || '?';
    const place = data.place || '?';
    return `${data.type}.${num} P.${place}`;
  }
  
  if (data.type === 'PID') {
    return `PID ${data.pid || '?'}`;
  }
  
  if (data.type === 'CUSTOM') {
    return data.number || 'Custom';
  }
  
  if (data.type === 'NONE') {
    return 'Kein Lagerort';
  }
  
  return '';
}

export default function LocationBuilder({
  value,
  onChange,
  numberSuggestions = [],
  placeSuggestions = [],
  pidSuggestions = [],
}: LocationBuilderProps) {
  const suggestionId = useId();
  const [preview, setPreview] = useState('');
  const [customLocations, setCustomLocations] = useState<string[]>([]);
  const [loadingCustom, setLoadingCustom] = useState(false);

  useEffect(() => {
    setPreview(generateLocationCode(value));
  }, [value]);

  // Lade CUSTOM Lagerorte wenn Typ CUSTOM gewählt wird
  useEffect(() => {
    if (value.type === 'CUSTOM') {
      setLoadingCustom(true);
      getCustomLocations()
        .then(setCustomLocations)
        .catch(() => setCustomLocations([]))
        .finally(() => setLoadingCustom(false));
    }
  }, [value.type]);

  const handleTypeChange = (type: LocationType) => {
    onChange({
      type,
      number: undefined,
      place: undefined,
      pid: undefined,
    });
  };

  const handleNumberChange = (number: string) => {
    onChange({ ...value, number });
  };

  const handlePlaceChange = (place: string) => {
    onChange({ ...value, place });
  };

  const handlePidChange = (pid: string) => {
    onChange({ ...value, pid });
  };

  return (
    <div className="space-y-3">
      {/* Step 1: Location Type */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1">
          Lagerort-Typ
        </label>
        <select
          value={value.type || ''}
          onChange={(e) => handleTypeChange(e.target.value as LocationType)}
          className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
        >
          <option value="">-- Typ wählen --</option>
          {LOCATION_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </div>

      {/* Step 2: Conditional Inputs */}
      {value.type && (
        <div className="grid grid-cols-2 gap-3">
          {(value.type === 'S' || value.type === 'ES' || value.type === 'R') && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Schrank/Regal-Nr.
                </label>
                <input
                  type="text"
                  list={`location-number-${suggestionId}`}
                  value={value.number || ''}
                  onChange={(e) => handleNumberChange(e.target.value)}
                  placeholder="z.B. 4"
                  className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                />
                <datalist id={`location-number-${suggestionId}`}>
                  {numberSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Platz-Nr. (P)
                </label>
                <input
                  type="text"
                  list={`location-place-${suggestionId}`}
                  value={value.place || ''}
                  onChange={(e) => handlePlaceChange(e.target.value)}
                  placeholder="z.B. 155"
                  className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                />
                <datalist id={`location-place-${suggestionId}`}>
                  {placeSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
                </datalist>
              </div>
            </>
          )}

          {value.type === 'PID' && (
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Paletten-ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  list={`location-pid-${suggestionId}`}
                  value={value.pid || ''}
                  onChange={(e) => handlePidChange(e.target.value)}
                  placeholder="z.B. 150234563"
                  className="flex-1 px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                />
                <datalist id={`location-pid-${suggestionId}`}>
                  {pidSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
                </datalist>
                <button
                  type="button"
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg"
                  title="QR-Code scannen"
                >
                  📷
                </button>
              </div>
            </div>
          )}

          {value.type === 'CUSTOM' && (
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Benutzerdefinierter Code
              </label>
              <input
                type="text"
                list="custom-locations-list"
                value={value.number || ''}
                onChange={(e) => handleNumberChange(e.target.value)}
                placeholder="z.B. A1-B2 oder aus Liste wählen"
                className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
              />
              <datalist id="custom-locations-list">
                {loadingCustom ? (
                  <option value="">Wird geladen...</option>
                ) : customLocations.length > 0 ? (
                  customLocations.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))
                ) : (
                  <option value="">Keine benutzerdefinierten Lagerorte vorhanden</option>
                )}
              </datalist>
              <p className="text-xs text-slate-500 mt-1">
                Wählen Sie einen vorhandenen Code oder geben Sie einen neuen ein
              </p>
            </div>
          )}
        </div>
      )}

      {/* Live Preview Badge */}
      {preview && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Vorschau:</span>
          <span className="bg-indigo-950/40 text-indigo-300 px-3 py-1 rounded font-mono text-sm border border-indigo-900/70">
            {preview}
          </span>
        </div>
      )}
    </div>
  );
}
