import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CREATIVE_BLOCK_ITEMS,
  CREATIVE_CATALOG_ITEMS,
  CREATIVE_EGG_ITEMS,
} from '@domain/inventory/Item';
import { inventoryIconPath } from '@presentation/InventoryItemIcons';

describe('inventory icon assets', () => {
  const inventoryItems = [
    ...CREATIVE_BLOCK_ITEMS,
    ...CREATIVE_CATALOG_ITEMS,
    ...CREATIVE_EGG_ITEMS,
  ];

  it('has a transformed SVG for every item visible in the creative catalogue', () => {
    expect(inventoryItems).toHaveLength(154);
    for (const item of inventoryItems) {
      const path = join(process.cwd(), 'public', inventoryIconPath(item));
      expect(existsSync(path), `missing ${path}`).toBe(true);
    }
  });

  it('uses vector pixels rather than embedding the source raster atlas', () => {
    const path = join(
      process.cwd(),
      'public',
      inventoryIconPath(CREATIVE_CATALOG_ITEMS[0]),
    );
    const svg = readFileSync(path, 'utf8');

    expect(svg).toContain('<rect');
    expect(svg).toContain('rotate(-7 8 8)');
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('data:image');
  });
});
