/**
 * Immutable 3D vector value object.
 *
 * Domain code passes `Vec3` across boundaries; hot inner loops (meshing,
 * collision) work on raw numbers to avoid allocation.
 */
export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class Vec3 implements Vec3Like {
  static readonly ZERO = new Vec3(0, 0, 0);
  static readonly UP = new Vec3(0, 1, 0);

  readonly x: number;
  readonly y: number;
  readonly z: number;

  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    Object.freeze(this);
  }

  static from(v: Vec3Like): Vec3 {
    return new Vec3(v.x, v.y, v.z);
  }

  add(v: Vec3Like): Vec3 {
    return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  subtract(v: Vec3Like): Vec3 {
    return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  scale(s: number): Vec3 {
    return new Vec3(this.x * s, this.y * s, this.z * s);
  }

  lengthSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length(): number {
    return Math.sqrt(this.lengthSquared());
  }

  distanceTo(v: Vec3Like): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  normalized(): Vec3 {
    const len = this.length();
    return len > 1e-9 ? this.scale(1 / len) : Vec3.ZERO;
  }

  floor(): Vec3 {
    return new Vec3(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
  }

  equals(v: Vec3Like): boolean {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }

  toString(): string {
    return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)}, ${this.z.toFixed(2)})`;
  }
}

/** Linear interpolation between two vectors; `t` is not clamped. */
export function lerpVec3(a: Vec3Like, b: Vec3Like, t: number): Vec3 {
  return new Vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
