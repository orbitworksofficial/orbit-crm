# Branding

## The logo

`public/logo.png` is the supplied Orbit Works artwork (1600×800, RGBA). Two
derived assets are generated from it and committed alongside:

| File | Size | Used for |
|---|---|---|
| `logo.png` | 1600×800 | Source of truth. Not rendered directly. |
| `logo-mark.png` | 256×256 | Favicon, invoice PDF header |
| `logo-full.png` | 1000×204 | Login screen, sidebar, mobile header |

### Why two derivatives, not one

In the source artwork **"Orbit" and the tagline are white**; only the orbital
symbol and "Works" are pink. Dropped onto a light background, half the wordmark
disappears.

So the full lockup is **always** placed on a dark plate (`#0b1120`) — the ground
it was drawn for. The plate is structural, not decorative; removing it makes
half the wordmark disappear in light mode.

`src/components/layout/Logo.tsx` encapsulates this as three variants. Nothing
else should reference the image files directly.

| Variant | Renders | Where |
|---|---|---|
| `full` | Lockup on a plate, 36px tall | Login screen |
| `bar` | Same lockup, 24px tall | Sidebar, drawer, mobile header |
| `mark` | Orbital symbol + live text | Reserved for tight or light surfaces |

`mark` exists as a fallback for places where a dark plate would be intrusive.
It pairs the pink symbol — which reads on any surface — with the company name
as live text that inherits the theme's ink colour. Nothing currently uses it in
the chrome, but it is the right answer if a future surface cannot take a plate.

### Regenerating the derivatives

If a new `logo.png` is supplied, regenerate with:

```js
// node -e "...", with sharp (already present via Next.js)
const sharp = require('sharp');

// Orbital mark, square, transparent
sharp('public/logo.png')
  .extract({ left: 177, top: 239, width: 298, height: 249 })
  .resize(256, 256, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } })
  .png({ compressionLevel: 9 })
  .toFile('public/logo-mark.png');

// Full lockup, trimmed of transparent padding
sharp('public/logo.png')
  .extract({ left: 177, top: 239, width: 1270, height: 259 })
  .resize({ width: 1000, withoutEnlargement: true })
  .png({ compressionLevel: 9 })
  .toFile('public/logo-full.png');
```

The extract bounds were derived by scanning for non-transparent pixels; a
differently-cropped source will need them recalculated.

Favicons live at `src/app/icon.png` (32×32) and `src/app/apple-icon.png`
(200×200 on the brand navy, since iOS composites over white). Next.js picks
these up by filename — no `<link>` tags required.

---

## Colour

The pink sampled from the logo is **`#fb093b`**. It is exposed as `--brand`
and used for decorative marks and rules.

It is **not** used as the button colour. White text on `#fb093b` measures
**4.04:1**, below the 4.5:1 WCAG AA threshold for body-size text — fine for a
logo, not fine for a button label. `--primary` is therefore a slightly deeper
step of the same hue:

| Token | Light | Dark | White text on it |
|---|---|---|---|
| `--brand` | `#fb093b` | `#fb093b` | 4.04:1 — decorative only |
| `--primary` | `#d81a55` | `#e01050` | 5.00:1 / 4.82:1 — passes |

Dark mode previously used `#ff2d6b`, which measured 3.60:1 against white text.
That was a real accessibility defect and was corrected when the brand colour
was formalised.

**Rule of thumb:** `--brand` for marks and ornament, `--primary` for anything
carrying text or acting as a control.

Chart colours are a separate, independently validated set — see the comments in
`src/app/globals.css`.

---

## Client-uploaded logos

Settings → Company profile accepts a logo upload, stored in the `branding`
bucket and used in the invoice PDF header. When no logo has been uploaded the
PDF falls back to `logo-mark.png`, so an invoice is never unbranded.

This matters for Phase 2: when the CRM is sold to other businesses, each tenant
uploads their own mark and the Orbit Works fallback simply stops applying.
