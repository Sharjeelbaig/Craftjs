# Craftjs brand guidelines

Craftjs is a deterministic voxel sandbox for the browser. Its identity should
feel engineered, optimistic and playable: a small system whose rules are clear
enough to trust.

## Brand idea: the open chunk

Seven blue voxel cubes form an open **C**. The opening is deliberate: it makes
the mark feel like a world in progress instead of a sealed object. A detached
gold cube sits at that opening and represents the next intentional change—the
block a player places, or the small stable feature a contributor adds.

This idea supports the product promise:

> **Stable worlds. One block at a time.**

The mark is an original geometric identity. It should not be restyled to imitate
Minecraft or another voxel game's logo, textures or typography.

## Core assets

| Asset | Purpose |
| --- | --- |
| [`logo-mark.svg`](logo-mark.svg) | Primary mark on light or neutral surfaces |
| [`logo-mark-dark.svg`](logo-mark-dark.svg) | Brighter mark for dark surfaces |
| [`wordmark.svg`](wordmark.svg) | Horizontal lockup for light surfaces |
| [`wordmark-dark.svg`](wordmark-dark.svg) | Horizontal lockup for dark surfaces |
| [`favicon.svg`](favicon.svg) | Compact mark in a Night tile |
| [`favicon-512.png`](favicon-512.png) | Raster app icon and touch icon |
| [`scene.svg`](scene.svg) | Animated repository and community avatar scene |
| [`social-card.svg`](social-card.svg) | Editable 1280 × 640 sharing card |
| [`social-card.png`](social-card.png) | Ready-to-publish sharing card |
| [`logo-concept.png`](logo-concept.png) | Exploratory raster rendering; not a master |
| [`../banner.svg`](../banner.svg) | Repository hero and announcement banner |

SVG files are the source of truth. Export PNG derivatives from those files;
never redraw the production mark from the raster concept.

## Color

| Token | Hex | Use |
| --- | --- | --- |
| Night | `#101820` | Primary dark background and icon tile |
| Warm Cloud | `#F4F7F2` | Text and surfaces on Night |
| Sky | `#53B7E8` | Primary brand face and interactive accent |
| Bright Sky | `#8FDFFF` | Highlight on dark backgrounds |
| Deep Water | `#1D5F78` | Supporting brand face and panels |
| Water Shadow | `#174C61` | Voxel depth and dark supporting detail |
| Grass | `#A7D948` | Positive or living-world accent |
| Sun | `#F6C85F` | The next block and singular callout |
| Sun Shadow | `#D89D28` | Depth on the gold voxel |
| Earth | `#8A5D3B` | Terrain detail only |

Night and Warm Cloud are the default text pair. Sky is the primary interactive
color. Sun should remain scarce so the detached block stays meaningful; do not
use it for paragraphs or large background fields. Check text contrast whenever
the palette is used outside the supplied assets.

## Typography

The wordmark uses a heavy geometric system-sans construction:

```css
font-family: "Arial Black", Inter, ui-sans-serif, system-ui, sans-serif;
font-weight: 900;
```

Product UI and technical copy use the existing monospace system stack:

```css
font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
```

These stacks deliberately require no downloaded fonts. Do not substitute a
bevelled, cracked or faux-pixel display face for the wordmark.

## Logo use

- Prefer the horizontal wordmark when the available width is at least `140px`.
- Use the standalone mark at `24px` or larger. Below `24px`, use the favicon.
- Keep clear space around the mark equal to one blue voxel's top-face width.
- Use the default assets on light surfaces and `-dark` assets on Night or
  photographic backgrounds.
- Place the logo on a quiet field or contained panel when the background is
  visually busy.
- Keep the gold cube attached to the lockup at its authored distance.

Do not rotate, stretch, outline, add glow, add texture, recolor individual
faces, move the gold block, or place other objects inside the open **C**. Do not
rebuild the mark with a different cube count.

## Voice

Craftjs speaks like a careful builder: calm, direct, technically literate and
respectful of the player's time.

Prefer:

- **Stable worlds. One block at a time.**
- **A deterministic voxel sandbox for the browser.**
- **Minimal setup. Durable worlds.**
- Short verbs and factual descriptions of behaviour.

Avoid:

- Calling Craftjs a “Minecraft clone”.
- Claiming “infinite”, “production-ready” or “complete” without evidence.
- Hype language that hides a limitation or stability tradeoff.
- Jokes in errors, permanent-death warnings or data-deletion actions.

Use `Craftjs` in prose and page titles. The lowercase `craftjs` form belongs to
the authored wordmark and package identifier. Avoid the mixed form `CraftJS`.

## UI expression

The interface inherits the voxel system without becoming ornamental:

- Use crisp grid alignment, flat fields and decisive 2–3px edges.
- Use small radii only for containers, not every control.
- Keep one primary accent per view; reserve Sun for an exceptional action or
  state.
- Use motion to explain state in roughly `120–180ms`.
- Respect `prefers-reduced-motion`; no feature may depend on animation.
- Prefer stable layouts over parallax, excessive glow or continuously moving
  decorative layers.

The start menu may sit over a generated world scene, but controls must remain
legible on a darkened panel and the brand lockup must retain a quiet area.

## Asset production

- Work in the SVG sources using whole-number view boxes.
- Preserve the exact palette values above.
- Export the favicon at `512 × 512`.
- Export the social card at `1280 × 640`.
- Keep social-card text and the complete logo inside an `80px` safe area.
- Test the mark at `24px`, the wordmark at `140px`, and every asset on both
  light and dark surfaces before release.

`logo-concept.png` is an AI-assisted visual-origin study with a transparent
background. It establishes material and dimensional mood only; the hand-built
SVG system is the reproducible production identity.
