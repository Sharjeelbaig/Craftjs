import type { ItemId } from '@domain/inventory/Item';

const ICON_ROOT = '/assets/inventory-icons';

/** Stable presentation path; item rules never depend on an artwork filename. */
export function inventoryIconPath(item: ItemId): string {
  return `${ICON_ROOT}/${item.replace(':', '_')}.svg`;
}

export function createInventoryItemIcon(item: ItemId): HTMLImageElement {
  const image = document.createElement('img');
  image.className = 'inventory-item__icon';
  image.src = inventoryIconPath(item);
  image.width = 16;
  image.height = 16;
  image.alt = '';
  image.draggable = false;
  image.decoding = 'async';
  return image;
}
