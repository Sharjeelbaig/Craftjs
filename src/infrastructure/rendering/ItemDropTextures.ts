import * as THREE from 'three';
import {
  ResourceItemId,
  itemDefinition,
  type ItemId,
} from '@domain/inventory/Item';

const SIZE = 16;
type Context = CanvasRenderingContext2D;

/**
 * Creates an original Craftjs pixel icon for any typed inventory item.
 *
 * The catalogue is deliberately rendered from primitives rather than a copied
 * atlas. Icons share a visual grammar by item category while their material,
 * silhouette and deterministic highlights keep individual entries readable.
 */
export function createItemSpriteCanvas(item: ItemId): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext('2d', { alpha: true });
  if (context === null) throw new Error('Cannot create item sprite texture');
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, SIZE, SIZE);

  const raw = item.startsWith('item:') ? item.slice(5) : '';
  if (drawKnownResource(context, raw)) return canvas;

  const definition = itemDefinition(item);
  if (definition === null) {
    drawUnknown(context);
    return canvas;
  }

  switch (definition.kind) {
    case 'block':
      drawBlock(context, definition.name);
      break;
    case 'spawnEgg':
      drawSpawnEgg(context, definition.name);
      break;
    case 'tool':
      drawTool(context, definition.name);
      break;
    case 'equipment':
      drawEquipment(context, definition.name);
      break;
    case 'food':
      drawFood(context, definition.name);
      break;
    case 'resource':
      drawMaterial(context, definition.name);
      break;
    case 'utility':
      drawUtility(context, definition.name);
      break;
  }
  return canvas;
}

/** Creates a nearest-filtered world sprite from the same icon used by the HUD. */
export function createItemSpriteTexture(item: ItemId): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(createItemSpriteCanvas(item));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function drawKnownResource(context: Context, item: string): boolean {
  switch (item) {
    case ResourceItemId.RawPorkchop:
      drawMeat(context, '#6f3437', '#d8898d', '#f1b1ad');
      return true;
    case ResourceItemId.RawBeef:
      drawMeat(context, '#55221f', '#a44339', '#df7364');
      return true;
    case ResourceItemId.Leather:
      drawHide(context);
      return true;
    case ResourceItemId.RawChicken:
      drawChicken(context);
      return true;
    case ResourceItemId.Feather:
      drawFeather(context);
      return true;
    case ResourceItemId.RawMutton:
      drawMeat(context, '#67252b', '#b94f54', '#e07d79');
      return true;
    case ResourceItemId.Wool:
      drawWool(context);
      return true;
    case ResourceItemId.RottenFlesh:
      drawRottenFlesh(context);
      return true;
    case ResourceItemId.String:
      drawString(context);
      return true;
    case ResourceItemId.SpiderEye:
      drawSpiderEye(context);
      return true;
    case ResourceItemId.Bone:
      drawBone(context);
      return true;
    case ResourceItemId.Arrow:
      drawArrow(context);
      return true;
    case ResourceItemId.Gunpowder:
      drawGunpowder(context);
      return true;
    default:
      return false;
  }
}

function drawBlock(context: Context, name: string): void {
  const hue = hueFor(name);
  const top = `hsl(${hue} 42% 60%)`;
  const left = `hsl(${hue} 45% 38%)`;
  const right = `hsl(${(hue + 8) % 360} 48% 29%)`;
  context.fillStyle = top;
  context.beginPath();
  context.moveTo(2, 5);
  context.lineTo(8, 2);
  context.lineTo(14, 5);
  context.lineTo(8, 8);
  context.closePath();
  context.fill();
  context.fillStyle = left;
  context.beginPath();
  context.moveTo(2, 5);
  context.lineTo(8, 8);
  context.lineTo(8, 14);
  context.lineTo(2, 11);
  context.closePath();
  context.fill();
  context.fillStyle = right;
  context.beginPath();
  context.moveTo(8, 8);
  context.lineTo(14, 5);
  context.lineTo(14, 11);
  context.lineTo(8, 14);
  context.closePath();
  context.fill();
  rect(context, `hsl(${hue} 35% 73%)`, 5, 4, 3, 1);
  rect(context, `hsl(${hue} 42% 25%)`, 10, 9, 2, 2);
}

function drawSpawnEgg(context: Context, name: string): void {
  const hue = hueFor(name);
  rect(context, `hsl(${hue} 45% 27%)`, 6, 2, 4, 1);
  rect(context, `hsl(${hue} 48% 30%)`, 4, 3, 8, 2);
  rect(context, `hsl(${hue} 52% 33%)`, 3, 5, 10, 6);
  rect(context, `hsl(${hue} 50% 29%)`, 4, 11, 8, 2);
  rect(context, `hsl(${hue} 44% 25%)`, 6, 13, 4, 1);
  const accentHue = (hue + 145) % 360;
  const seed = hash(name);
  for (let index = 0; index < 7; index++) {
    const x = 4 + ((seed >> (index * 2)) & 7);
    const y = 4 + ((seed >> (index + 3)) & 7);
    rect(context, `hsl(${accentHue} 62% 66%)`, x, y, index % 3 === 0 ? 2 : 1, 1);
  }
  rect(context, 'rgba(255,255,255,.55)', 5, 4, 2, 3);
}

function drawTool(context: Context, name: string): void {
  if (name === 'Shears') {
    drawShears(context);
    return;
  }
  if (name === 'Flint and Steel') {
    rect(context, '#525c64', 4, 3, 7, 2);
    rect(context, '#b8c0c5', 3, 4, 2, 7);
    rect(context, '#7d8589', 5, 10, 6, 2);
    rect(context, '#33383b', 9, 5, 3, 6);
    rect(context, '#ed7c36', 11, 2, 2, 3);
    return;
  }

  const palette = toolPalette(name);
  rect(context, '#49331e', 4, 10, 8, 2);
  rect(context, '#76502b', 5, 9, 8, 1);
  if (name.includes('Sword')) {
    rect(context, palette.dark, 7, 3, 2, 7);
    rect(context, palette.base, 8, 2, 2, 7);
    rect(context, palette.light, 9, 2, 1, 5);
    rect(context, '#49331e', 5, 9, 6, 2);
    rect(context, '#8b6336', 3, 12, 3, 2);
  } else if (name.includes('Pickaxe')) {
    rect(context, palette.dark, 3, 3, 10, 2);
    rect(context, palette.base, 4, 2, 7, 2);
    rect(context, palette.light, 5, 2, 4, 1);
  } else if (name.includes('Axe')) {
    rect(context, palette.dark, 8, 2, 5, 5);
    rect(context, palette.base, 7, 3, 5, 3);
    rect(context, palette.light, 8, 3, 3, 1);
  } else if (name.includes('Shovel')) {
    rect(context, palette.dark, 9, 2, 4, 5);
    rect(context, palette.base, 8, 3, 4, 4);
    rect(context, palette.light, 9, 3, 2, 2);
  } else {
    rect(context, palette.dark, 6, 2, 7, 2);
    rect(context, palette.base, 7, 3, 2, 4);
    rect(context, palette.light, 8, 2, 4, 1);
  }
}

function drawShears(context: Context): void {
  rect(context, '#738087', 4, 3, 2, 8);
  rect(context, '#b9c1c2', 5, 3, 2, 7);
  rect(context, '#667178', 9, 3, 2, 8);
  rect(context, '#d3d7d5', 10, 2, 2, 8);
  rect(context, '#8c9497', 6, 8, 4, 2);
  context.strokeStyle = '#a36b3d';
  context.lineWidth = 2;
  context.strokeRect(3, 11, 4, 3);
  context.strokeRect(9, 11, 4, 3);
}

function drawEquipment(context: Context, name: string): void {
  if (name === 'Saddle') {
    rect(context, '#4b241b', 3, 5, 10, 7);
    rect(context, '#8d432b', 4, 4, 8, 6);
    rect(context, '#c17545', 5, 5, 6, 3);
    rect(context, '#d6b36c', 4, 9, 8, 1);
    rect(context, '#51301f', 3, 12, 2, 3);
    rect(context, '#51301f', 11, 11, 2, 4);
    return;
  }
  const palette = toolPalette(name);
  if (name.includes('Helmet')) {
    rect(context, palette.dark, 3, 4, 10, 7);
    rect(context, palette.base, 4, 3, 8, 6);
    rect(context, palette.light, 5, 4, 4, 2);
    rect(context, '#20242a', 5, 8, 6, 3);
  } else if (name.includes('Chestplate')) {
    rect(context, palette.dark, 2, 4, 12, 4);
    rect(context, palette.base, 4, 3, 8, 11);
    rect(context, palette.light, 5, 4, 3, 5);
    rect(context, '#20242a', 7, 3, 2, 3);
  } else if (name.includes('Leggings')) {
    rect(context, palette.dark, 4, 3, 8, 5);
    rect(context, palette.base, 5, 4, 6, 5);
    rect(context, palette.base, 4, 8, 3, 6);
    rect(context, palette.dark, 9, 8, 3, 6);
    rect(context, '#20242a', 7, 8, 2, 6);
  } else {
    rect(context, palette.dark, 3, 6, 4, 7);
    rect(context, palette.base, 4, 5, 3, 6);
    rect(context, palette.dark, 9, 6, 4, 7);
    rect(context, palette.base, 9, 5, 3, 6);
    rect(context, palette.light, 4, 6, 2, 2);
    rect(context, palette.light, 9, 6, 2, 2);
  }
}

function drawFood(context: Context, name: string): void {
  if (/Chicken|Mutton|Porkchop|Steak|Beef/u.test(name)) {
    const cooked = name.startsWith('Cooked') || name === 'Steak';
    drawMeat(
      context,
      cooked ? '#3f1f17' : '#65252a',
      cooked ? '#8b4327' : '#c45b60',
      cooked ? '#c87a43' : '#eb8b88',
    );
    return;
  }
  if (name.includes('Apple')) {
    const golden = name.startsWith('Golden');
    rect(context, golden ? '#8d6815' : '#632322', 4, 5, 9, 7);
    rect(context, golden ? '#e5b936' : '#c33c3a', 3, 6, 10, 5);
    rect(context, golden ? '#ffe46a' : '#f16a55', 5, 5, 5, 6);
    rect(context, '#5b3d21', 8, 2, 2, 4);
    rect(context, '#5b8b3c', 10, 3, 3, 2);
    return;
  }
  if (/Potato|Carrot/u.test(name)) {
    const carrot = name === 'Carrot';
    rect(context, carrot ? '#b34d20' : '#83653b', 5, 5, 7, 7);
    rect(context, carrot ? '#ed7a2e' : '#c79b59', 4, 6, 7, 6);
    rect(context, carrot ? '#f3a144' : '#e2bd78', 5, 6, 3, 3);
    rect(context, carrot ? '#4f8a3a' : '#75553b', 7, 2, 2, 4);
    rect(context, carrot ? '#76ad4d' : '#75553b', 9, 3, 3, 2);
    return;
  }
  if (name === 'Cake') {
    rect(context, '#8b5535', 2, 8, 12, 5);
    rect(context, '#f2d7b7', 2, 5, 12, 5);
    rect(context, '#fff0d8', 3, 4, 10, 3);
    rect(context, '#db4e58', 4, 4, 2, 2);
    rect(context, '#db4e58', 10, 5, 2, 2);
    return;
  }
  if (name === 'Cookie') {
    rect(context, '#6e411f', 4, 3, 8, 11);
    rect(context, '#b87538', 3, 5, 10, 7);
    rect(context, '#db9b50', 5, 4, 6, 9);
    rect(context, '#3f291a', 5, 6, 2, 2);
    rect(context, '#3f291a', 9, 9, 2, 2);
    return;
  }
  if (/Stew|Milk/u.test(name)) {
    drawBowlOrBucket(context, name === 'Milk' ? '#e8eee9' : '#8d5534');
    return;
  }
  if (name === 'Bread') {
    rect(context, '#70431f', 3, 5, 10, 8);
    rect(context, '#c88236', 4, 4, 8, 8);
    rect(context, '#e7ad55', 5, 5, 6, 5);
    rect(context, '#8e5528', 6, 4, 1, 4);
    rect(context, '#8e5528', 9, 4, 1, 4);
    return;
  }
  drawOrganic(context, name, '#805031');
}

function drawMaterial(context: Context, name: string): void {
  const dye = dyeColour(name);
  if (dye !== null) {
    drawPowder(context, dye);
    return;
  }
  if (name.includes('Seeds')) {
    rect(context, '#3e5a2a', 4, 4, 2, 7);
    rect(context, '#77a94a', 6, 3, 2, 9);
    rect(context, '#a4c35b', 8, 6, 4, 2);
    rect(context, '#667d36', 3, 10, 9, 2);
    return;
  }
  if (/Ingot|Brick/u.test(name)) {
    const golden = name.startsWith('Gold');
    rect(context, golden ? '#8a6514' : '#6d7476', 3, 7, 10, 5);
    rect(context, golden ? '#e7bb36' : '#b9c1c0', 4, 6, 8, 5);
    rect(context, golden ? '#ffe067' : '#e1e6df', 5, 7, 5, 2);
    return;
  }
  if (/Diamond|Coal|Flint|Clay|Lapis/u.test(name)) {
    const colour = name === 'Diamond'
      ? '#52d7d4'
      : name === 'Lapis Lazuli'
        ? '#315bc0'
        : name === 'Clay'
          ? '#9eabb0'
          : '#3e4445';
    drawGem(context, colour);
    return;
  }
  if (/Stick|Sugar Canes|Wheat/u.test(name)) {
    const colour = name === 'Wheat' ? '#d1a73c' : name === 'Sugar Canes' ? '#73b85e' : '#835a31';
    rect(context, '#4d3921', 5, 11, 8, 2);
    rect(context, colour, 6, 9, 7, 2);
    rect(context, colour, 8, 6, 5, 2);
    rect(context, colour, 10, 3, 3, 2);
    return;
  }
  drawPowder(context, colourFor(name));
}

function drawUtility(context: Context, name: string): void {
  if (name.includes('Bucket')) {
    const fill = name.startsWith('Water') ? '#45a4d8' : name.startsWith('Lava') ? '#ef6b28' : '#313941';
    drawBowlOrBucket(context, fill);
    return;
  }
  if (name.includes('Sapling') || name === 'Dandelion' || name === 'Rose') {
    const flower = name === 'Rose' ? '#d84545' : name === 'Dandelion' ? '#f0cf3c' : '#62a84b';
    rect(context, '#684a29', 7, 7, 2, 7);
    rect(context, '#39723c', 4, 6, 4, 3);
    rect(context, '#55984d', 8, 4, 5, 4);
    rect(context, flower, 6, 2, 4, 4);
    return;
  }
  if (name === 'Torch') {
    rect(context, '#5c3e21', 7, 6, 2, 8);
    rect(context, '#a96f30', 8, 6, 2, 7);
    rect(context, '#ef8e28', 6, 3, 4, 4);
    rect(context, '#ffe56c', 7, 2, 2, 4);
    return;
  }
  if (name === 'Ladder' || name === 'Door' || name === 'Sign') {
    rect(context, '#5d3e20', 3, 3, 2, 11);
    rect(context, '#9a6a36', 4, 3, 8, 11);
    rect(context, '#c28b49', 5, 4, 6, 2);
    rect(context, '#6b4825', 5, 8, 6, 1);
    rect(context, '#6b4825', 5, 11, 6, 1);
    return;
  }
  if (name === 'Clock' || name === 'Compass') {
    const clock = name === 'Clock';
    rect(context, clock ? '#8c6818' : '#777e80', 4, 3, 8, 11);
    rect(context, clock ? '#e0b63c' : '#c7cfce', 3, 5, 10, 7);
    rect(context, '#263c4a', 5, 5, 6, 6);
    rect(context, clock ? '#f0d45a' : '#e64d4d', 8, 6, 1, 4);
    rect(context, '#eef3e8', clock ? 9 : 7, clock ? 8 : 7, 3, 1);
    return;
  }
  if (name === 'Book' || name === 'Paper' || name === 'Painting') {
    rect(context, '#5b3322', 3, 3, 10, 11);
    rect(context, name === 'Paper' ? '#e7e4d4' : '#be7650', 4, 3, 8, 10);
    rect(context, '#f3efe0', 5, 4, 6, 8);
    rect(context, '#7a8fa0', 6, 6, 4, 2);
    return;
  }
  if (name === 'Snowball') {
    rect(context, '#aebbbe', 4, 4, 8, 9);
    rect(context, '#e8f1ef', 3, 6, 10, 6);
    rect(context, '#fff', 5, 4, 5, 6);
    return;
  }
  drawOrganic(context, name, colourFor(name));
}

function drawBowlOrBucket(context: Context, fill: string): void {
  rect(context, '#50585a', 3, 3, 10, 2);
  rect(context, '#929b9b', 2, 4, 2, 7);
  rect(context, '#6d7779', 12, 4, 2, 7);
  rect(context, '#454d50', 4, 11, 8, 3);
  rect(context, fill, 4, 5, 8, 6);
  rect(context, 'rgba(255,255,255,.42)', 5, 5, 4, 1);
}

function drawGem(context: Context, colour: string): void {
  rect(context, '#273035', 6, 2, 4, 2);
  rect(context, colour, 4, 4, 8, 8);
  rect(context, colour, 6, 2, 4, 12);
  rect(context, 'rgba(255,255,255,.55)', 5, 5, 3, 3);
  rect(context, 'rgba(0,0,0,.25)', 9, 8, 3, 3);
}

function drawPowder(context: Context, colour: string): void {
  rect(context, shade(colour, 0.62), 3, 10, 10, 3);
  rect(context, colour, 4, 8, 8, 4);
  rect(context, shade(colour, 1.25), 6, 6, 4, 3);
  rect(context, shade(colour, 1.45), 7, 5, 2, 2);
  rect(context, colour, 3, 7, 2, 2);
  rect(context, shade(colour, 0.75), 11, 7, 2, 2);
}

function drawOrganic(context: Context, name: string, colour: string): void {
  const seed = hash(name);
  const dark = shade(colour, 0.58);
  const light = shade(colour, 1.32);
  rect(context, dark, 3, 4, 10, 9);
  rect(context, colour, 4, 3, 8, 10);
  rect(context, light, 5, 4, 4, 4);
  for (let index = 0; index < 4; index++) {
    rect(context, dark, 4 + ((seed >> (index * 3)) & 7), 5 + ((seed >> index) & 7), 1, 1);
  }
}

function drawUnknown(context: Context): void {
  rect(context, '#5c3d76', 3, 3, 10, 10);
  rect(context, '#b792d1', 5, 4, 6, 2);
  rect(context, '#b792d1', 8, 6, 3, 3);
  rect(context, '#b792d1', 7, 10, 2, 2);
}

interface ToolPalette {
  readonly dark: string;
  readonly base: string;
  readonly light: string;
}

function toolPalette(name: string): ToolPalette {
  if (name.startsWith('Diamond')) {
    return { dark: '#287c82', base: '#48cad0', light: '#a0f1ea' };
  }
  if (name.startsWith('Golden')) {
    return { dark: '#8a6617', base: '#e3b62e', light: '#ffe776' };
  }
  if (name.startsWith('Iron') || name.startsWith('Chainmail')) {
    return { dark: '#687275', base: '#aeb8b8', light: '#e8eeea' };
  }
  if (name.startsWith('Stone')) {
    return { dark: '#41494a', base: '#747d7b', light: '#aeb4af' };
  }
  if (name.startsWith('Leather')) {
    return { dark: '#59331f', base: '#9d6036', light: '#d49a58' };
  }
  return { dark: '#4b311b', base: '#81562c', light: '#bc8c4c' };
}

function dyeColour(name: string): string | null {
  const dyes: Readonly<Record<string, string>> = {
    'Magenta Dye': '#c54fa2',
    'Purple Dye': '#7641a6',
    'Light Blue Dye': '#62aee1',
    'Cactus Green': '#378344',
    'Lime Dye': '#79c748',
    'Dandelion Yellow': '#e7ca35',
    'Orange Dye': '#e87d29',
    'Rose Red': '#b8353e',
    'Pink Dye': '#e98fa5',
    'Ink Sac': '#26303a',
    'Gray Dye': '#6c7477',
    'Light Gray Dye': '#b8bebc',
    'Bone Meal': '#e7e2d4',
    Sugar: '#f2eee2',
  };
  return dyes[name] ?? null;
}

function hueFor(value: string): number {
  return hash(value) % 360;
}

function colourFor(value: string): string {
  return `hsl(${hueFor(value)} 48% 52%)`;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function shade(colour: string, factor: number): string {
  if (!colour.startsWith('#') || colour.length !== 7) return colour;
  const value = Number.parseInt(colour.slice(1), 16);
  const channel = (shift: number): number =>
    Math.max(0, Math.min(255, Math.round(((value >> shift) & 0xff) * factor)));
  return `rgb(${channel(16)} ${channel(8)} ${channel(0)})`;
}

function rect(context: Context, colour: string, x: number, y: number, w: number, h: number): void {
  context.fillStyle = colour;
  context.fillRect(x, y, w, h);
}

function drawMeat(context: Context, dark: string, base: string, light: string): void {
  rect(context, dark, 4, 2, 7, 1);
  rect(context, dark, 3, 3, 10, 2);
  rect(context, dark, 2, 5, 12, 6);
  rect(context, dark, 3, 11, 9, 2);
  rect(context, dark, 5, 13, 5, 1);
  rect(context, base, 4, 3, 7, 2);
  rect(context, base, 3, 5, 10, 6);
  rect(context, base, 4, 11, 7, 1);
  rect(context, light, 5, 4, 4, 2);
  rect(context, light, 4, 6, 3, 2);
  rect(context, '#f3d0b0', 10, 8, 3, 2);
}

function drawHide(context: Context): void {
  rect(context, '#4c2b18', 3, 2, 3, 2);
  rect(context, '#4c2b18', 10, 2, 3, 2);
  rect(context, '#4c2b18', 2, 4, 12, 8);
  rect(context, '#4c2b18', 4, 12, 3, 2);
  rect(context, '#4c2b18', 9, 12, 3, 2);
  rect(context, '#9a6337', 4, 4, 8, 8);
  rect(context, '#b67b45', 5, 5, 4, 5);
  rect(context, '#704321', 10, 6, 2, 4);
}

function drawChicken(context: Context): void {
  rect(context, '#8f6559', 3, 3, 8, 1);
  rect(context, '#8f6559', 2, 4, 11, 7);
  rect(context, '#8f6559', 4, 11, 7, 2);
  rect(context, '#e5c5ad', 3, 4, 9, 7);
  rect(context, '#f5dfcb', 4, 4, 5, 3);
  rect(context, '#d98f91', 7, 8, 4, 3);
  rect(context, '#eee3d1', 11, 11, 2, 3);
  rect(context, '#7b553c', 13, 12, 1, 2);
}

function drawFeather(context: Context): void {
  rect(context, '#8c9598', 4, 11, 8, 1);
  rect(context, '#dce8e8', 5, 9, 7, 2);
  rect(context, '#f5fbfa', 6, 7, 7, 2);
  rect(context, '#dce8e8', 7, 5, 6, 2);
  rect(context, '#f5fbfa', 9, 3, 4, 2);
  rect(context, '#6c777a', 3, 12, 8, 1);
  rect(context, '#9eaaac', 6, 9, 1, 3);
  rect(context, '#9eaaac', 8, 7, 1, 3);
  rect(context, '#9eaaac', 10, 5, 1, 3);
}

function drawWool(context: Context): void {
  rect(context, '#9b9b98', 3, 3, 10, 10);
  rect(context, '#deded8', 2, 5, 12, 6);
  rect(context, '#f5f4eb', 4, 3, 3, 3);
  rect(context, '#eeeeE7', 8, 2, 4, 4);
  rect(context, '#ffffff', 4, 6, 8, 5);
  rect(context, '#c9c9c3', 5, 11, 7, 2);
}

function drawRottenFlesh(context: Context): void {
  rect(context, '#3f3420', 4, 2, 7, 1);
  rect(context, '#5a4527', 2, 4, 12, 8);
  rect(context, '#795b31', 3, 3, 8, 10);
  rect(context, '#9a7640', 4, 4, 4, 3);
  rect(context, '#59622e', 9, 4, 3, 4);
  rect(context, '#3f4b25', 5, 9, 4, 3);
  rect(context, '#b08a4b', 9, 9, 3, 2);
}

function drawString(context: Context): void {
  rect(context, '#6b7173', 3, 4, 9, 1);
  rect(context, '#e7eceb', 4, 3, 8, 1);
  rect(context, '#e7eceb', 3, 5, 2, 5);
  rect(context, '#e7eceb', 5, 9, 6, 2);
  rect(context, '#e7eceb', 10, 6, 2, 4);
  rect(context, '#aeb7b7', 6, 6, 4, 1);
  rect(context, '#aeb7b7', 5, 7, 1, 2);
}

function drawSpiderEye(context: Context): void {
  rect(context, '#3a171b', 4, 3, 8, 1);
  rect(context, '#57151d', 2, 5, 12, 6);
  rect(context, '#8e1e2b', 3, 4, 10, 8);
  rect(context, '#cf3b42', 5, 5, 6, 6);
  rect(context, '#f1776c', 6, 6, 2, 2);
  rect(context, '#2a1518', 8, 7, 3, 3);
  rect(context, '#e7b55a', 9, 8, 1, 1);
}

function drawBone(context: Context): void {
  rect(context, '#77776d', 3, 11, 3, 3);
  rect(context, '#77776d', 10, 2, 3, 3);
  rect(context, '#77776d', 5, 9, 6, 3);
  rect(context, '#e6e0ca', 3, 10, 3, 3);
  rect(context, '#e6e0ca', 10, 2, 3, 3);
  rect(context, '#f5efd8', 5, 8, 6, 3);
  rect(context, '#f5efd8', 7, 6, 4, 3);
  rect(context, '#c4c0ae', 5, 11, 2, 1);
}

function drawArrow(context: Context): void {
  rect(context, '#4c3923', 4, 11, 8, 2);
  rect(context, '#8b6634', 5, 10, 7, 1);
  rect(context, '#d5d3c5', 10, 4, 2, 7);
  rect(context, '#ecead9', 11, 3, 2, 7);
  rect(context, '#9a9b91', 12, 2, 2, 4);
  rect(context, '#f2f3ed', 2, 11, 4, 1);
  rect(context, '#d9dedc', 3, 9, 1, 4);
}

function drawGunpowder(context: Context): void {
  rect(context, '#242826', 3, 10, 10, 3);
  rect(context, '#3c413f', 2, 11, 12, 2);
  rect(context, '#555b58', 4, 8, 8, 3);
  rect(context, '#707672', 6, 6, 4, 3);
  rect(context, '#8c918d', 7, 5, 2, 2);
  rect(context, '#4a504d', 3, 7, 2, 2);
  rect(context, '#333836', 11, 7, 2, 2);
}
