import type { ItemId } from '../inventory/Item';
import type { PhysicsBody } from './Mob';

export const ITEM_DROP_PICKUP_DELAY = 0.45;
export const ITEM_DROP_LIFETIME = 5 * 60;

let nextDropId = 1;

/** Collectible item stack with its own bounded world lifetime. */
export class ItemDrop implements PhysicsBody {
  readonly id: number;

  previousX: number;
  previousY: number;
  previousZ: number;

  velocityX: number;
  velocityY: number;
  velocityZ: number;
  onGround = false;
  inLiquid = false;
  age = 0;
  removed = false;

  constructor(
    readonly item: ItemId,
    readonly count: number,
    public x: number,
    public y: number,
    public z: number,
    velocityX = 0,
    velocityY = 0,
    velocityZ = 0,
  ) {
    this.id = nextDropId++;
    this.previousX = x;
    this.previousY = y;
    this.previousZ = z;
    this.velocityX = velocityX;
    this.velocityY = velocityY;
    this.velocityZ = velocityZ;
  }

  beginTick(): void {
    this.previousX = this.x;
    this.previousY = this.y;
    this.previousZ = this.z;
  }

  get collectable(): boolean {
    return !this.removed && this.age >= ITEM_DROP_PICKUP_DELAY;
  }

  get expired(): boolean {
    return this.removed || this.age >= ITEM_DROP_LIFETIME;
  }
}

/** Test-only; item drops are intentionally not persisted. */
export function resetItemDropIds(): void {
  nextDropId = 1;
}
