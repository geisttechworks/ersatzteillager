import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pbMock, recordCollection, batchCollection, batch } = vi.hoisted(() => {
  const recordCollection = { getOne: vi.fn(), update: vi.fn(), create: vi.fn(), getList: vi.fn() };
  const batchCollection = { update: vi.fn(), create: vi.fn() };
  const batch = { collection: vi.fn(), send: vi.fn() };
  const pbMock = {
    authStore: { model: { email: 'test@example.invalid' } },
    collection: vi.fn(),
    filter: vi.fn(),
    createBatch: vi.fn(),
  };
  return { pbMock, recordCollection, batchCollection, batch };
});

vi.mock('../src/lib/pocketbase', () => ({ default: pbMock }));

import { findDeliveryNoteImport, updateQuantityWithAudit, updateSparePart } from '../src/lib/pocketbaseServices';

describe('PocketBase booking service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordCollection.getOne.mockResolvedValue({ id: 'part-id', quantity: 9, category_id: null });
    recordCollection.getList.mockResolvedValue({ items: [{ id: 'log-id', user_name: 'Techniker' }] });
    pbMock.collection.mockReturnValue(recordCollection);
    pbMock.filter.mockReturnValue('parameterized-filter');
    pbMock.createBatch.mockReturnValue(batch);
    batch.collection.mockReturnValue(batchCollection);
    batch.send.mockResolvedValue([{ status: 200, body: { id: 'part-id', quantity: 4 } }, { status: 200, body: {} }]);
  });

  it('updates stock and writes its audit record in one atomic PocketBase batch', async () => {
    await updateQuantityWithAudit('part-id', 4, 'out', {
      reason: 'Lieferung/Wareneingang',
      supplier: 'Musterlieferant',
      order_number: 'PO-21',
      delivery_note_number: '2628225',
    });

    expect(pbMock.createBatch).toHaveBeenCalledOnce();
    expect(batchCollection.update).toHaveBeenCalledWith('part-id', { quantity: 4 }, { expand: 'category_id' });
    expect(batchCollection.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'out',
      quantity: 5,
      previous_quantity: 9,
      new_quantity: 4,
      delivery_note_number: '2628225',
      supplier: 'Musterlieferant',
      order_number: 'PO-21',
    }));
    expect(batch.send).toHaveBeenCalledOnce();
    expect(recordCollection.update).not.toHaveBeenCalled();
    expect(recordCollection.create).not.toHaveBeenCalled();
  });

  it('rejects a negative resulting stock before creating a batch', async () => {
    await expect(updateQuantityWithAudit('part-id', -1, 'out', {
      reason: 'Sonstiges',
    })).rejects.toThrow(/ab 0/);
    expect(pbMock.createBatch).not.toHaveBeenCalled();
  });

  it('logs stock increases and decreases from updateSparePart with a positive absolute quantity', async () => {
    await updateSparePart('part-id', { quantity: 12 });
    expect(batchCollection.create).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'in', quantity: 3, previous_quantity: 9, new_quantity: 12 }));

    vi.clearAllMocks();
    recordCollection.getOne.mockResolvedValue({ id: 'part-id', quantity: 9, category_id: null });
    pbMock.collection.mockReturnValue(recordCollection);
    pbMock.createBatch.mockReturnValue(batch);
    batch.collection.mockReturnValue(batchCollection);
    batch.send.mockResolvedValue([{ status: 200, body: { id: 'part-id', quantity: 4 } }, { status: 200, body: {} }]);
    await updateSparePart('part-id', { quantity: 4 });
    expect(batchCollection.create).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'out', quantity: 5, previous_quantity: 9, new_quantity: 4 }));
  });

  it('does not write a zero-quantity inventory movement for a metadata-only edit', async () => {
    recordCollection.update.mockResolvedValue({ id: 'part-id', name: 'Updated' });
    await updateSparePart('part-id', { name: 'Updated' });
    expect(recordCollection.update).toHaveBeenCalledOnce();
    expect(pbMock.createBatch).not.toHaveBeenCalled();
  });

  it('does not make separate stock or audit writes when the atomic batch fails', async () => {
    batch.send.mockRejectedValueOnce(new Error('batch rejected'));

    await expect(updateQuantityWithAudit('part-id', 4, 'out', {
      reason: 'Sonstiges',
    })).rejects.toThrow('batch rejected');

    expect(recordCollection.update).not.toHaveBeenCalled();
    expect(recordCollection.create).not.toHaveBeenCalled();
    expect(batch.send).toHaveBeenCalledOnce();
  });

  it('passes delivery note and supplier values as PocketBase filter parameters', async () => {
    const deliveryNote = '2628225" || id != "';
    const supplier = 'Musterlieferant" || id != "';

    const result = await findDeliveryNoteImport(deliveryNote, supplier);

    expect(pbMock.filter).toHaveBeenCalledWith(
      'delivery_note_number = {:number} && supplier = {:supplier}',
      { number: deliveryNote, supplier },
    );
    expect(recordCollection.getList).toHaveBeenCalledWith(1, 1, {
      filter: 'parameterized-filter',
      sort: '-created',
    });
    expect(result?.user_name).toBe('Techniker');
  });
});
