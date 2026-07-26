import { inflateSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceRoot = resolve(
  process.argv[2] ??
    '/Users/shazi/Downloads/Minecraft PSP 3.4.2/Assets/Textures/Default',
);
const outputRoot = resolve('public/assets/inventory-icons');
const itemAtlas = await decodePng(await readFile(resolve(sourceRoot, 'items.png')));
const terrainAtlas = await decodePng(await readFile(resolve(sourceRoot, 'terrain.png')));

/** @type {Map<string, { atlas: 'items' | 'terrain', x: number, y: number }>} */
const icons = new Map();
const item = (id, x, y) => icons.set(id, { atlas: 'items', x, y });
const terrain = (id, x, y) => icons.set(id, { atlas: 'terrain', x, y });

// Craftjs block catalogue. PSP renders these from its terrain atlas.
terrain('block:1', 1, 0);
terrain('block:2', 2, 0);
terrain('block:3', 0, 0);
terrain('block:4', 2, 1);
terrain('block:6', 4, 1);
terrain('block:7', 4, 3);
terrain('block:8', 4, 0);
terrain('block:9', 0, 1);
terrain('block:10', 1, 3);
terrain('block:12', 2, 4);
terrain('block:13', 7, 0);

// Creature loot and general resources.
item('item:raw-porkchop', 7, 5);
item('item:raw-beef', 9, 6);
item('item:leather', 7, 6);
item('item:raw-chicken', 9, 7);
item('item:feather', 8, 1);
item('item:raw-mutton', 11, 6);
terrain('item:wool', 0, 4);
item('item:rotten-flesh', 11, 5);
item('item:string', 8, 0);
item('item:spider-eye', 15, 2);
item('item:bone', 12, 1);
item('item:arrow', 5, 2);
item('item:gunpowder', 8, 2);

// Food.
item('item:cooked-chicken', 10, 7);
item('item:cooked-mutton', 12, 6);
item('item:cooked-porkchop', 8, 6);
item('item:carrot', 8, 7);
item('item:poisonous-potato', 6, 8);
item('item:baked-potato', 7, 7);
item('item:potato', 6, 7);
item('item:cake', 13, 1);
item('item:milk', 14, 4);
item('item:steak', 10, 6);
item('item:cookie', 12, 5);
item('item:mushroom-stew', 9, 4);
terrain('item:mushroom', 13, 1);
item('item:bread', 9, 2);
item('item:golden-apple', 11, 0);
item('item:apple', 10, 0);

// Equipment: columns are leather, chainmail, iron, diamond and gold.
const armourColumns = {
  leather: 0,
  chainmail: 1,
  iron: 2,
  diamond: 3,
  golden: 4,
};
const armourRows = { helmet: 0, chestplate: 1, leggings: 2, boots: 3 };
for (const [material, x] of Object.entries(armourColumns)) {
  for (const [piece, y] of Object.entries(armourRows)) {
    item(`item:${material}-${piece}`, x, y);
  }
}
item('item:saddle', 10, 15);

// Tools: rows are swords, shovels, pickaxes, axes and hoes.
const toolColumns = { wooden: 0, stone: 1, iron: 2, diamond: 3, golden: 4 };
const toolRows = { sword: 4, shovel: 5, pickaxe: 6, axe: 7, hoe: 8 };
for (const [material, x] of Object.entries(toolColumns)) {
  for (const [tool, y] of Object.entries(toolRows)) {
    item(`item:${material}-${tool}`, x, y);
  }
}
item('item:shears', 6, 5);
item('item:flint-and-steel', 5, 0);

// Dyes and powders.
const dyes = {
  'rose-red': [14, 5],
  'pink-dye': [15, 5],
  'cactus-green': [14, 6],
  'lime-dye': [15, 6],
  'cocoa-beans': [14, 7],
  'dandelion-yellow': [15, 7],
  'lapis-lazuli': [14, 8],
  'light-blue-dye': [15, 8],
  'purple-dye': [14, 9],
  'magenta-dye': [15, 9],
  'orange-dye': [15, 10],
  'gray-dye': [14, 11],
  'light-gray-dye': [15, 11],
  'bone-meal': [15, 11],
  'ink-sac': [15, 4],
};
for (const [id, [x, y]] of Object.entries(dyes)) item(`item:${id}`, x, y);

// Remaining materials and utility items.
item('item:music-disc', 0, 15);
item('item:pumpkin-seeds', 14, 3);
item('item:melon-seeds', 15, 3);
item('item:painting', 10, 1);
item('item:flower-pot', 15, 12);
item('item:sign', 10, 2);
item('item:compass', 7, 4);
item('item:clock', 6, 4);
item('item:flint', 6, 0);
item('item:sugar', 13, 0);
terrain('item:birch-sapling', 14, 1);
terrain('item:spruce-sapling', 14, 0);
terrain('item:torch', 0, 5);
terrain('item:ladder', 3, 5);
item('item:door', 11, 2);
item('item:bowl', 6, 3);
item('item:snowball', 14, 0);
item('item:book', 11, 3);
item('item:paper', 10, 3);
terrain('item:oak-sapling', 15, 0);
terrain('item:dandelion', 13, 0);
terrain('item:rose', 12, 0);
item('item:sugar-canes', 11, 1);
item('item:lava-bucket', 13, 4);
item('item:water-bucket', 12, 4);
item('item:bucket', 11, 4);
item('item:brick', 6, 1);
item('item:wheat', 9, 1);
item('item:clay', 9, 3);
item('item:gold-ingot', 7, 2);
item('item:diamond', 7, 3);
item('item:iron-ingot', 7, 1);
item('item:coal', 7, 0);
item('item:stick', 5, 3);

// Spawn eggs: same creature palettes as the supplied inventory atlas.
item('egg:0', 3, 14); // Pig
item('egg:1', 0, 14); // Cow
item('egg:2', 2, 14); // Chicken
item('egg:3', 1, 14); // Sheep
item('egg:4', 4, 14); // Zombie
item('egg:5', 6, 14); // Spider
item('egg:7', 8, 14); // Skeleton
item('egg:8', 5, 14); // Creeper
item('egg:9', 7, 14); // Cave Spider

await mkdir(outputRoot, { recursive: true });
for (const [id, source] of icons) {
  const atlas = source.atlas === 'items' ? itemAtlas : terrainAtlas;
  const pixels = extractTile(atlas, source.x, source.y);
  if (pixels.length === 0) {
    throw new Error(`${id} maps to an empty ${source.atlas} cell ${source.x},${source.y}`);
  }
  const svg = vectorise(id, source, pixels);
  await writeFile(resolve(outputRoot, `${fileName(id)}.svg`), svg, 'utf8');
}

console.log(`Generated ${icons.size} transformed inventory SVGs in ${outputRoot}`);

function fileName(id) {
  return id.replace(':', '_');
}

function extractTile(atlas, tileX, tileY) {
  const pixels = [];
  for (let y = 0; y < 16; y += 2) {
    for (let x = 0; x < 16; x += 2) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let offsetY = 0; offsetY < 2; offsetY++) {
        for (let offsetX = 0; offsetX < 2; offsetX++) {
          const sourceX = tileX * 16 + x + offsetX;
          const sourceY = tileY * 16 + y + offsetY;
          const index = (sourceY * atlas.width + sourceX) * 4;
          const pixelAlpha = atlas.data[index + 3] / 255;
          red += atlas.data[index] * pixelAlpha;
          green += atlas.data[index + 1] * pixelAlpha;
          blue += atlas.data[index + 2] * pixelAlpha;
          alpha += pixelAlpha;
        }
      }
      if (alpha <= 0.08) continue;
      const averagedAlpha = Math.min(1, alpha / 4);
      red /= alpha;
      green /= alpha;
      blue /= alpha;
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const greyMix = 0.28;
      pixels.push({
        x,
        y,
        red: Math.round(red * (1 - greyMix) + luminance * greyMix),
        green: Math.round(green * (1 - greyMix) + luminance * greyMix),
        blue: Math.round(blue * (1 - greyMix) + luminance * greyMix),
        alpha: averagedAlpha,
      });
    }
  }
  return pixels;
}

function vectorise(id, source, pixels) {
  const rectangles = pixels
    .map(
      ({ x, y, red, green, blue, alpha }) =>
        `<rect x="${x}" y="${y}" width="2" height="2" fill="rgb(${red} ${green} ${blue})" fill-opacity="${alpha.toFixed(3)}"/>`,
    )
    .join('');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 18 18" shape-rendering="crispEdges">',
    `<title>${escapeXml(id)}</title>`,
    `<metadata>Derived from supplied PSP ${source.atlas} atlas cell ${source.x},${source.y}; 2px vector pixels, 28% grayscale mix, -7deg rotation.</metadata>`,
    `<g transform="rotate(-7 8 8)">${rectangles}</g>`,
    '</svg>',
    '',
  ].join('');
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function decodePng(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error('Unsupported PNG signature');

  let offset = 8;
  let width = 0;
  let height = 0;
  const compressed = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) {
        throw new Error('Only non-interlaced 8-bit RGBA PNG atlases are supported');
      }
    } else if (type === 'IDAT') {
      compressed.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const raw = inflateSync(Buffer.concat(compressed));
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  let sourceOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[sourceOffset++];
    for (let x = 0; x < stride; x++) {
      const encoded = raw[sourceOffset++];
      const target = y * stride + x;
      const left = x >= bytesPerPixel ? pixels[target - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[target - stride] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? pixels[target - stride - bytesPerPixel] : 0;
      pixels[target] = unfilter(filter, encoded, left, up, upperLeft);
    }
  }
  return { width, height, data: pixels };
}

function unfilter(filter, encoded, left, up, upperLeft) {
  if (filter === 0) return encoded;
  if (filter === 1) return (encoded + left) & 0xff;
  if (filter === 2) return (encoded + up) & 0xff;
  if (filter === 3) return (encoded + Math.floor((left + up) / 2)) & 0xff;
  if (filter === 4) return (encoded + paeth(left, up, upperLeft)) & 0xff;
  throw new Error(`Unsupported PNG filter ${filter}`);
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}
