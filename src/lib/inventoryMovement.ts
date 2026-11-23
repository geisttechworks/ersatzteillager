export type InventoryAction = 'in' | 'out';

export interface InventoryMovement {
  delta: number;
  action: InventoryAction;
  quantity: number;
}

export function calculateInventoryMovement(previousQuantity: number, newQuantity: number): InventoryMovement {
  if (!Number.isFinite(previousQuantity) || previousQuantity < 0
    || !Number.isFinite(newQuantity) || newQuantity < 0) {
    throw new Error('Bestände müssen gültige Zahlen ab 0 sein.');
  }

  const delta = newQuantity - previousQuantity;
  return { delta, action: delta < 0 ? 'out' : 'in', quantity: Math.abs(delta) };
}

export interface ImportSummaryItem {
  success: boolean;
  imported?: boolean;
  quantity: number;
  isNew: boolean;
}

export function summarizeDeliveryNoteImport(items: readonly ImportSummaryItem[]) {
  const imported = items.filter((item) => item.success && item.imported === true);
  return {
    quantityBooked: imported.reduce((sum, item) => sum + item.quantity, 0),
    newlyCreated: imported.filter((item) => item.isNew).length,
  };
}
