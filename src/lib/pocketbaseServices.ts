import pb from './pocketbase';
import { calculateInventoryMovement } from './inventoryMovement';

// Types direkt hier definiert, um Import-Probleme zu vermeiden
export type Category = {
  id: string;
  name: string;
  description?: string;
  created: string;
  updated: string;
}

export type Location = {
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
  supplier?: string;
  description?: string;
  technical_data?: string;
  additional_info?: string;
  unit?: string;
  price?: number;
  quantity: number;
  min_quantity: number;
  location_id: string | null;
  location_type?: string;
  location_number?: string;
  location_place?: string;
  location_pid?: string;
  location_data?: Record<string, any>;
  link?: string;
  attachment?: string;
  qr_code: string;
  created: string;
  updated: string;
  category?: Category;
  location?: Location;
}

export type InventoryLog = {
  id: string;
  spare_part_id: string;
  action: 'in' | 'out';
  quantity: number;
  previous_quantity: number;
  new_quantity: number;
  created: string;
  notes?: string;
  spare_part?: {
    name: string;
    article_number: string;
  };
  user_name?: string;
  user_agent?: string;
  reason?: 'Reparatur/Instandhaltung' | 'Lieferung/Wareneingang' | 'Inventur/Korrektur' | 'Zur Überholung' | 'Von Überholung zurück' | 'Verschrottung/Defekt' | 'Sonstiges';
  supplier?: string;
  order_number?: string;
  delivery_note_number?: string;
  metadata?: Record<string, any>;
}

export type StockMovement = {
  spare_part_id: string;
  action: 'in' | 'out';
  quantity: number;
  reason: 'Reparatur/Instandhaltung' | 'Lieferung/Wareneingang' | 'Inventur/Korrektur' | 'Zur Überholung' | 'Von Überholung zurück' | 'Verschrottung/Defekt' | 'Sonstiges';
  supplier?: string;
  order_number?: string;
  delivery_note_number?: string;
  notes?: string;
  metadata?: Record<string, any>;
}

// ============ KATEGORIEN ============
export async function getCategories() {
  const records = await pb.collection('categories').getFullList({
    sort: 'name'
  });
  return records as unknown as Category[];
}

export async function createCategory(name: string, description?: string) {
  const record = await pb.collection('categories').create({
    name,
    description
  });
  return record as unknown as Category;
}

export async function deleteCategory(id: string) {
  await pb.collection('categories').delete(id);
}

// ============ CUSTOM LOCATIONS ============
export async function getCustomLocations() {
  const records = await pb.collection('spare_parts').getFullList({
    filter: 'location_type = "CUSTOM" && location_number != null',
    fields: 'location_number',
    sort: 'location_number'
  });
  
  const distinctCodes = [...new Set(records.map(p => p.location_number).filter(Boolean))];
  return distinctCodes as string[];
}

// ============ ERSATZTEILE ============

// Automatische Artikelnummer-Generierung ab 2000
export async function getNextArticleNumber(): Promise<string> {
  try {
    const records = await pb.collection('spare_parts').getFullList({
      fields: 'article_number'
    });

    const usedNumbers = new Set(
      records
        .map((record) => String(record.article_number ?? '').trim())
        .filter((value) => /^\d+$/.test(value))
    );

    let candidate = 2000;
    while (usedNumbers.has(String(candidate))) candidate++;
    return String(candidate);
  } catch (error) {
    throw new Error('Die nächste Artikelnummer konnte wegen eines Verbindungsfehlers nicht ermittelt werden.', { cause: error });
  }
}

export async function getSpareParts() {
  const records = await pb.collection('spare_parts').getFullList({
    expand: 'category_id',
    sort: 'name'
  });
  
  return records.map(record => ({
    ...record,
    category: record.expand?.category_id || null
  })) as unknown as SparePart[];
}

export async function getSparePartById(id: string) {
  let record;
  try {
    record = await pb.collection('spare_parts').getOne(id, { expand: 'category_id' });
  } catch (error: any) {
    if (error?.status !== 404) throw error;
    const legacyRecord = await getSparePartByLegacyId(id);
    if (legacyRecord) return legacyRecord;
    const articleRecord = await getSparePartByArticleNumber(id);
    if (articleRecord) return articleRecord;
    throw error;
  }
  
  return {
    ...record,
    category: record.expand?.category_id || null
  } as unknown as SparePart;
}

export async function getSparePartByLegacyId(legacyId: string) {
  const records = await pb.collection('spare_parts').getFullList({
    filter: pb.filter('legacy_id = {:id}', { id: legacyId }),
    expand: 'category_id',
    limit: 1
  });

  if (records.length === 0) return null;
  return {
    ...records[0],
    category: records[0].expand?.category_id || null
  } as unknown as SparePart;
}

export function getSparePartDisplayId(part: Pick<SparePart, 'legacy_id' | 'article_number' | 'id'>): string {
  return part.legacy_id?.trim() || part.article_number || part.id;
}

export async function getSparePartByArticleNumber(articleNumber: string) {
  try {
    const records = await pb.collection('spare_parts').getFullList({
      filter: pb.filter('article_number = {:number}', { number: articleNumber }),
      expand: 'category_id',
      limit: 1
    });
    
    if (records.length === 0) return null;
    
    return {
      ...records[0],
      category: records[0].expand?.category_id || null
    } as unknown as SparePart;
  } catch (error) {
    if ((error as any).status === 404) return null;
    throw error;
  }
}

export async function getSparePartByQRCode(qrCode: string) {
  const record = await pb.collection('spare_parts').getFirstListItem(pb.filter('qr_code = {:code}', { code: qrCode }), {
    expand: 'category_id'
  });
  
  return {
    ...record,
    category: record.expand?.category_id || null
  } as unknown as SparePart;
}

export async function searchSpareParts(searchTerm: string) {
  const records = await pb.collection('spare_parts').getFullList({
    filter: pb.filter('name ~ {:term} || article_number ~ {:term} || legacy_id ~ {:term} || installation_location ~ {:term} || anlage ~ {:term} || manufacturer ~ {:term}', { term: searchTerm }),
    expand: 'category_id',
    sort: 'name'
  });
  
  return records.map(record => ({
    ...record,
    category: record.expand?.category_id || null
  })) as unknown as SparePart[];
}

function validateSparePartInput(input: Partial<SparePart>, requireName: boolean) {
  if (requireName && (typeof input.name !== 'string' || !input.name.trim())) {
    throw new Error('Die Bezeichnung ist erforderlich.');
  }
  if (input.name !== undefined && (typeof input.name !== 'string' || input.name.trim().length > 200)) {
    throw new Error('Die Bezeichnung darf höchstens 200 Zeichen lang sein.');
  }
  if (input.article_number !== undefined && (typeof input.article_number !== 'string' || input.article_number.length > 100)) {
    throw new Error('Die Artikelnummer darf höchstens 100 Zeichen lang sein.');
  }
  if (input.legacy_id !== undefined && (typeof input.legacy_id !== 'string' || input.legacy_id.length > 100)) {
    throw new Error('Die Excel-ID darf höchstens 100 Zeichen lang sein.');
  }
  for (const [field, label] of [['installation_location', 'Einbauort'], ['anlage', 'Anlage']] as const) {
    const value = input[field];
    if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 200)) {
      throw new Error(`${label} darf höchstens 200 Zeichen lang sein.`);
    }
  }
  for (const field of ['price', 'quantity', 'min_quantity'] as const) {
    const value = input[field];
    if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      throw new Error(`${field === 'price' ? 'Der Preis' : field === 'quantity' ? 'Der Bestand' : 'Der Mindestbestand'} muss eine gültige Zahl ab 0 sein.`);
    }
  }
  if (input.link) {
    try {
      const url = new URL(input.link);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      throw new Error('Der Link muss eine gültige HTTP- oder HTTPS-Adresse sein.');
    }
  }
}

export async function createSparePart(sparePart: Partial<Omit<SparePart, 'id' | 'qr_code' | 'created' | 'updated'>>) {
  validateSparePartInput(sparePart as Partial<SparePart>, true);
  const validColumns = [
    'name', 'legacy_id', 'installation_location', 'anlage', 'article_number', 'description', 'technical_data', 'additional_info',
    'manufacturer', 'supplier', 'unit', 'price', 'quantity', 'min_quantity',
    'link', 'attachment', 'category_id',
    'location_type', 'location_number', 'location_place', 'location_pid', 'location_data'
  ];

  const sanitizedSparePart: any = {};
  for (const key of validColumns) {
    if (key in sparePart) {
      const value = sparePart[key as keyof SparePart];
      if (value === '') {
        sanitizedSparePart[key] = null;
      } else if (key === 'article_number' && typeof value === 'string') {
        sanitizedSparePart[key] = value.trim();
      } else if (key === 'legacy_id' && typeof value === 'string') {
        sanitizedSparePart[key] = value.trim();
      } else {
        sanitizedSparePart[key] = value;
      }
    }
  }

  const generateArticleNumber = !sanitizedSparePart.article_number || sanitizedSparePart.article_number.trim() === '';
  let record: any;

  // A database unique index is the final guard against simultaneous imports/creates.
  // If another request reserves the same candidate first, fetch the next free number.
  for (let attempt = 0; attempt < 5; attempt++) {
    if (generateArticleNumber) {
      sanitizedSparePart.article_number = await getNextArticleNumber();
    }

    try {
      record = await pb.collection('spare_parts').create(sanitizedSparePart, {
        expand: 'category_id'
      });
      break;
    } catch (error: any) {
      const articleNumberError = error?.data?.data?.article_number;
      const isDuplicateArticleNumber = articleNumberError?.code === 'validation_not_unique'
        || /UNIQUE constraint failed.*article_number/i.test(error?.message || '');

      if (!isDuplicateArticleNumber) throw error;
      if (!generateArticleNumber) {
        throw new Error(`Die Artikelnummer ${sanitizedSparePart.article_number} ist bereits vergeben.`, { cause: error });
      }
      if (attempt === 4) {
        throw new Error('Es konnte keine freie Artikelnummer vergeben werden. Bitte erneut versuchen.', { cause: error });
      }
    }
  }

  if (!record) throw new Error('Das Ersatzteil konnte nicht erstellt werden.');

  return {
    ...record,
    category: record.expand?.category_id || null
  } as unknown as SparePart;
}

export async function updateSparePart(id: string, updates: Partial<SparePart>) {
  validateSparePartInput(updates, false);
  const currentPart = await getSparePartById(id);
  
  const validColumns = [
    'name', 'legacy_id', 'installation_location', 'anlage', 'article_number', 'description', 'technical_data', 'additional_info',
    'manufacturer', 'supplier', 'unit', 'price', 'quantity', 'min_quantity',
    'link', 'attachment', 'category_id',
    'location_type', 'location_number', 'location_place', 'location_pid'
  ];
  
  const sanitizedUpdates: any = {};
  for (const key of validColumns) {
    if (key in updates) {
      const value = updates[key as keyof SparePart];
      if (value === '') {
        sanitizedUpdates[key] = null;
      } else if (key === 'article_number' && typeof value === 'string') {
        sanitizedUpdates[key] = value.trim();
      } else if (key === 'legacy_id' && typeof value === 'string') {
        sanitizedUpdates[key] = value.trim();
      } else {
        sanitizedUpdates[key] = value;
      }
    }
  }
  
  const changes: string[] = [];
  if (updates.quantity !== undefined && updates.quantity !== currentPart.quantity) {
    changes.push(`Bestand: ${currentPart.quantity} → ${updates.quantity}`);
  }
  if (updates.quantity === undefined || updates.quantity === currentPart.quantity) {
    const record = await pb.collection('spare_parts').update(id, sanitizedUpdates, { expand: 'category_id' });
    return { ...record, category: record.expand?.category_id || null } as unknown as SparePart;
  }

  return updatePartAndLogAtomically(
    id,
    sanitizedUpdates,
    currentPart.quantity,
    updates.quantity !== undefined ? updates.quantity : currentPart.quantity,
    `Änderung: ${changes.join(', ')}`,
    getCurrentUser(),
  );
}

export async function deleteSparePart(id: string) {
  await pb.collection('spare_parts').delete(id);
}

export async function updateQuantity(id: string, newQuantity: number, action: 'in' | 'out', notes?: string) {
  validateSparePartInput({ quantity: newQuantity }, false);
  const currentPart = await getSparePartById(id);
  const previousQuantity = currentPart.quantity;

  const movement = calculateInventoryMovement(previousQuantity, newQuantity);
  if (movement.quantity > 0 && movement.action !== action) {
    throw new Error('Die gewählte Buchungsrichtung passt nicht zur Bestandsänderung.');
  }
  return updatePartAndLogAtomically(id, { quantity: newQuantity }, previousQuantity, newQuantity, notes, getCurrentUser());
}

export async function updateQuantityWithAudit(
  id: string,
  newQuantity: number,
  action: 'in' | 'out',
  auditData: {
    reason: 'Reparatur/Instandhaltung' | 'Lieferung/Wareneingang' | 'Inventur/Korrektur' | 'Zur Überholung' | 'Von Überholung zurück' | 'Verschrottung/Defekt' | 'Sonstiges';
    supplier?: string;
    order_number?: string;
    delivery_note_number?: string;
    delivery_date?: string;
    notes?: string;
    metadata?: Record<string, any>;
  }
) {
  validateSparePartInput({ quantity: newQuantity }, false);
  const currentPart = await getSparePartById(id);
  const previousQuantity = currentPart.quantity;

  const movement = calculateInventoryMovement(previousQuantity, newQuantity);
  if (movement.quantity > 0 && movement.action !== action) {
    throw new Error('Die gewählte Buchungsrichtung passt nicht zur Bestandsänderung.');
  }
  const extendedNotes = [
    auditData.notes || '',
    auditData.delivery_date ? `Lieferdatum: ${auditData.delivery_date}` : ''
  ].filter(Boolean).join(' | ');

  return updatePartAndLogAtomically(id, { quantity: newQuantity }, previousQuantity, newQuantity, extendedNotes, getCurrentUser(), {
    reason: auditData.reason,
    supplier: auditData.supplier,
    order_number: auditData.order_number,
    delivery_note_number: auditData.delivery_note_number,
    metadata: auditData.metadata,
  });
}

// ============ INVENTORY LOG ============
export async function logInventoryChange(
  sparePartId: string,
  action: 'in' | 'out',
  quantity: number,
  previousQuantity: number,
  newQuantity: number,
  notes?: string,
  userName?: string,
  auditData?: {
    reason?: string;
    supplier?: string;
    order_number?: string;
    delivery_note_number?: string;
    metadata?: Record<string, any>;
  }
) {
  const movement = calculateInventoryMovement(previousQuantity, newQuantity);
  if (movement.quantity > 0 && movement.action !== action) {
    throw new Error('Die gewählte Buchungsrichtung passt nicht zur Bestandsänderung.');
  }
  if (movement.quantity !== quantity) {
    throw new Error('Die gebuchte Menge passt nicht zur Bestandsänderung.');
  }
  await pb.collection('inventory_log').create(buildInventoryLogRecord(
    sparePartId, previousQuantity, newQuantity, notes, userName, auditData,
  ));
}

function buildInventoryLogRecord(
  sparePartId: string,
  previousQuantity: number,
  newQuantity: number,
  notes?: string,
  userName?: string,
  auditData?: {
    reason?: string;
    supplier?: string;
    order_number?: string;
    delivery_note_number?: string;
    metadata?: Record<string, any>;
  },
) {
  const movement = calculateInventoryMovement(previousQuantity, newQuantity);
  return {
    spare_part_id: sparePartId,
    action: movement.action,
    quantity: movement.quantity,
    previous_quantity: previousQuantity,
    new_quantity: newQuantity,
    notes,
    user_name: userName || getCurrentUser(),
    user_agent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    reason: auditData?.reason,
    supplier: auditData?.supplier,
    order_number: auditData?.order_number,
    delivery_note_number: auditData?.delivery_note_number,
    metadata: auditData?.metadata,
  };
}

async function updatePartAndLogAtomically(
  sparePartId: string,
  partUpdates: Partial<SparePart>,
  previousQuantity: number,
  newQuantity: number,
  notes?: string,
  userName?: string,
  auditData?: {
    reason?: string;
    supplier?: string;
    order_number?: string;
    delivery_note_number?: string;
    metadata?: Record<string, any>;
  },
) {
  const batch = pb.createBatch();
  batch.collection('spare_parts').update(sparePartId, partUpdates, { expand: 'category_id' });
  batch.collection('inventory_log').create(buildInventoryLogRecord(
    sparePartId, previousQuantity, newQuantity, notes, userName, auditData,
  ));
  const results = await batch.send();
  const record = results[0]?.body;
  if (!record) throw new Error('PocketBase hat keine Bestandsänderung zurückgegeben.');
  return { ...record, category: record.expand?.category_id || null } as unknown as SparePart;
}

export async function getInventoryLog(sparePartId?: string, limit?: number) {
  const query = {
    filter: sparePartId ? pb.filter('spare_part_id = {:id}', { id: sparePartId }) : '',
    sort: '-created',
    expand: 'spare_part_id'
  };
  const records = limit
    ? (await pb.collection('inventory_log').getList(1, limit, query)).items
    : await pb.collection('inventory_log').getFullList(query);
  
  return records.map(record => ({
    ...record,
    spare_part: record.expand?.spare_part_id ? {
      name: record.expand.spare_part_id.name,
      article_number: record.expand.spare_part_id.article_number
    } : null
  })) as unknown as InventoryLog[];
}

export async function findDeliveryNoteImport(deliveryNoteNumber: string, supplier: string) {
  const records = await pb.collection('inventory_log').getList(1, 1, {
    filter: pb.filter('delivery_note_number = {:number} && supplier = {:supplier}', {
      number: deliveryNoteNumber,
      supplier,
    }),
    sort: '-created',
  });
  return records.items[0] as unknown as InventoryLog | undefined;
}

// Hilfsfunktion für aktuellen Benutzer
export function getCurrentUser(): string {
  const model = pb.authStore.model;
  if (model && model.email) {
    return model.email;
  }
  if (model && model.name) {
    return model.name;
  }
  return 'Unbekannt';
}

// ============ STATISTIKEN ============
export async function getStatistics() {
  const [totalRecords, lowStockRecords, recentLogs] = await Promise.all([
    pb.collection('spare_parts').getList(1, 1, { count: true }),
    pb.collection('spare_parts').getFullList({ sort: 'quantity', expand: 'category_id' }),
    getInventoryLog()
  ]);

  const lowStockItems = lowStockRecords.filter(part => part.quantity < part.min_quantity);

  return {
    totalSpareParts: totalRecords.totalItems,
    lowStockCount: lowStockItems.length,
    recentActivity: recentLogs.slice(0, 10),
    lowStockItems: lowStockItems.map(record => ({
      ...record,
      category: record.expand?.category_id || null
    })) as unknown as SparePart[]
  };
}

export async function getLowStockSpareParts() {
  const records = await pb.collection('spare_parts').getFullList({
    expand: 'category_id',
    sort: 'quantity'
  });

  return records
    .filter(part => part.quantity < part.min_quantity)
    .map(record => ({
      ...record,
      category: record.expand?.category_id || null
    })) as unknown as SparePart[];
}
