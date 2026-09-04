# public/textures/

Place 2048x2048 (or 1024x1024) PNG or JPG files here.
The surface upgrade script expects the following names.
Missing files fall back to solid-colour placeholders automatically.

## Track surfaces
  asphalt_albedo.jpg       dark grey road, faint aggregate speckle
  asphalt_normal.jpg       micro-bump normal map (OpenGL convention)
  asphalt_roughness.jpg    near-uniform high roughness ~0.92

## Ground / verge
  ground_albedo.jpg
  ground_normal.jpg
  ground_roughness.jpg

## Kerb strips
  kerb_albedo.jpg          red/white alternating stripe pattern
  kerb_normal.jpg
  kerb_roughness.jpg

## Crosswalk
  crosswalk_albedo.jpg     white stripe on dark background
  crosswalk_normal.jpg
  crosswalk_roughness.jpg

## Start/finish line bricks
  bricks_albedo.jpg
  bricks_normal.jpg
  bricks_roughness.jpg

## Barrier / jersey wall
  barrier_albedo.jpg
  barrier_normal.jpg
  barrier_roughness.jpg

## City roof
  roof_albedo.jpg
  roof_normal.jpg
  roof_roughness.jpg

## City facades (4 styles)
  facade_glass_albedo.jpg      + _normal + _roughness
  facade_brick_albedo.jpg      + _normal + _roughness
  facade_precast_albedo.jpg    + _normal + _roughness
  facade_commercial_albedo.jpg + _normal + _roughness

## Texture spec guidelines
  - Albedo maps: sRGB colour space
  - All other maps (normal, roughness, metalness): Linear colour space
  - Normal maps: OpenGL convention (green channel up)
  - Wrap mode: Repeat in both axes (set by loader)
  - Anisotropy: set automatically from QUALITY.tex.anisotropy
