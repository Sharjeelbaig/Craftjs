# Inventory icon assets

These SVGs are generated from the user-supplied PSP homebrew texture atlases by
`scripts/generate-inventory-icons.mjs`.

The converter turns each 16×16 raster cell into 2×2 SVG pixel rectangles, mixes
28% grayscale into the source colours, and rotates the icon by seven degrees.
Generated files are presentation assets only; the domain item catalogue does
not depend on them.

The visual transformation does not transfer copyright ownership or guarantee
that the source artwork may be redistributed. Replace this folder or the icon
adapter if the project cannot document permission for the supplied textures.
