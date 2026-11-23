import { describe, expect, it } from 'vitest';
import { calculateInventoryMovement, summarizeDeliveryNoteImport } from '../src/lib/inventoryMovement';

describe('calculateInventoryMovement', () => {
  it('records an increase as an inbound positive quantity', () => {
    expect(calculateInventoryMovement(4, 9)).toEqual({ delta: 5, action: 'in', quantity: 5 });
  });

  it('records a decrease as an outbound positive quantity', () => {
    expect(calculateInventoryMovement(9, 4)).toEqual({ delta: -5, action: 'out', quantity: 5 });
  });

  it('rejects negative or non-finite stock levels', () => {
    expect(() => calculateInventoryMovement(1, -1)).toThrow(/ab 0/);
    expect(() => calculateInventoryMovement(Number.NaN, 1)).toThrow(/ab 0/);
  });
});

describe('summarizeDeliveryNoteImport', () => {
  it('counts only successfully booked lines, including newly created parts', () => {
    expect(summarizeDeliveryNoteImport([
      { success: true, imported: true, quantity: 4, isNew: false },
      { success: true, imported: true, quantity: 2, isNew: true },
      { success: true, imported: false, quantity: 20, isNew: false },
      { success: false, imported: false, quantity: 8, isNew: true },
    ])).toEqual({ quantityBooked: 6, newlyCreated: 1 });
  });
});
