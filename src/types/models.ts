export type Category = {
  id: string;
  name: string;
  description?: string;
  created: string;
  updated: string;
}

export type SparePart = {
  id: string;
  legacy_id?: string;
  installation_location?: string;
  anlage?: string;
  name: string;
  article_number: string;
  category_id: string | null;
  manufacturer: string;
  supplier?: string; // Lieferant (aus Excel)
  description?: string;
  technical_data?: string; // Technische Daten (aus Excel)
  additional_info?: string; // Zusätzliche Angaben (aus Excel)
  unit?: string; // Einheit (aus Excel)
  price?: number; // Preis (aus Excel)
  quantity: number;
  min_quantity: number;
  // Strukturierte Lagerort-Felder (neu)
  location_type?: 'S' | 'ES' | 'R' | 'PID' | 'CUSTOM' | 'NONE' | null;
  location_number?: string | null;
  location_place?: string | null;
  location_pid?: string | null;
  location_data?: Record<string, any> | null; // Automatisch vom Trigger aktualisiert
  link?: string;
  attachment?: string;
  qr_code: string; // Einfach die ID als String (z.B. "5000")
  created: string;
  updated: string;
  category?: Category;
}

export type InventoryLog = {
  id: string;
  spare_part_id: string;
  action: 'in' | 'out';
  quantity: number;
  previous_quantity: number;
  new_quantity: number;
  timestamp: string;
  notes?: string;
  spare_part?: {
    name: string;
    article_number: string;
  };
}
