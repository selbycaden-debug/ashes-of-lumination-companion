# Theming

Emberfall is the current look. Colors, fonts, radii, shadows, glows, and textures live in one file so a later mockup can replace the theme without touching game rules.

## Where the look lives

- `src/theme/emberfall.css` is the theme. `:root` holds the tokens. `.f-lumen`, `.f-ashen`, `.f-unaligned`, and `.f-remnant` override `--acc`, `--acc-2`, `--acc-soft`, and `--glow`.
- `src/theme/ui.jsx` is the visual kit: `Stage`, `Fuse`, `TabBar`, `Avatar`, and `RoleHero`. These components do not decide votes, deaths, privacy, or phase changes.
- `src/index.css` only imports Tailwind (layout) and the theme.
- `index.html` loads the Google fonts named by the theme.

Textures and phase paintings are in `public/theme/`. Small role thumbnails stay in `public/portraits/` and `public/portraits-remnant/`.

## Change a color or font

Edit the token in `src/theme/emberfall.css`. Components use `var(--acc)`, `var(--bone)`, `var(--font-display)`, and the other tokens. Do not put a new hex color on a screen component.

Faction glow follows whoever is looking. `Stage` gets `f-lumen`, `f-ashen`, `f-unaligned`, or `f-remnant` from that player's own role. Shared screens (the lobby and Dawn Accord) stay on the default ember tokens. Each GM tile adds its own faction class.

## Swap a piece

| Piece | Component | Class |
| --- | --- | --- |
| Page frame, smoke, embers, phase painting | `Stage` | `.stage` |
| Timer | `Fuse` | `.fuse`, `.track` |
| Bottom tabs | `TabBar` | `.tabbar` |
| Role card | `RoleHero` | `.hero`, `.ident` |
| Panels | markup `className="panel"` | `.panel` |
| Primary button | markup `className="btn"` | `.btn` |
| GM player tile | markup `className="tile"` | `.tile` |

To try another timer, replace `Fuse` in `src/theme/ui.jsx` and the `.fuse` rules. Leave `useRemaining` and the `timer-start` actions alone. Those still own the countdown.

To try another theme, duplicate `emberfall.css`, point `src/index.css` at the new file, and keep the same token names (`--acc`, `--bone`, `--ember`, `--font-display`, `--radius`, `--glow`). Screens that only use those tokens will follow.
