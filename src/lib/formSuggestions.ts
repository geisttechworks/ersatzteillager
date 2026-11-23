import type { SparePart } from './pocketbaseServices';

export type SparePartSuggestionField =
  | 'name'
  | 'article_number'
  | 'installation_location'
  | 'anlage'
  | 'manufacturer'
  | 'supplier'
  | 'description'
  | 'technical_data'
  | 'additional_info'
  | 'unit'
  | 'link'
  | 'location_number'
  | 'location_place'
  | 'location_pid';

export function getExistingTextValues(parts: SparePart[], field: SparePartSuggestionField): string[] {
  const values = parts
    .map((part) => part[field])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());

  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
}
