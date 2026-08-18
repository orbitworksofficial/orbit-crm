# Branding

## The logo

`public/logo.png` is the supplied Orbit Works artwork (1600×800, RGBA). Two
derived assets are generated from it and committed alongside:

| File | Size | Used for |
|---|---|---|
| `logo.png` | 1600×800 | Source of truth. Not rendered directly. |
| `logo-full-light.png` | 1000×204 | Light theme — wordmark in `#0f172a` |
| `logo-full-dark.png` | 1000×204 | Dark theme — wordmark in `#f1f5f9` |
| `logo-mark.png` | 256×256 | Favicon, invoice PDF header |

### Why two recoloured versions

In the source artwork **"Orbit" and the tagline are white**; only the orbital
symbol and "Works" are pink. On a light background half the wordmark
disappears.

The first attempt put the artwork on a dark plate. That worked, but a dark box
around the logo reads as a mistake on a light page.

The fix is to recolour instead. The artwork separates cleanly — roughly 34,000
pink pixels and 19,000 white ones, with almost nothing in between — so the
white parts can be repainted per theme while the pink is left untouched. The
result is a logo that sits directly on the page in both themes with no
container at all.

### How the swap works

`Logo` renders **both** images and lets CSS show one (`dark:hidden` /
`hidden dark:block`).

That is deliberate. The viewer's theme is only known in the browser, so
choosing a single file on the server would flash the wrong artwork on load and
could never respond to the in-app theme toggle. The hidden image costs
essentially nothing — browsers skip decoding `display: none` images — and the
swap is instant.

`dark:` here maps to the `.dark` class (see `@custom-variant` in
`globals.css`), so it follows the toggle rather than only the OS setting.

### The component

`src/components/layout/Logo.tsx` is the only place that references these files.

| Export | Renders | Where |
|---|---|---|
| `<Logo size="lg">` | Full lockup, 36px | Login screen |
| `<Logo size="sm">` | Full lockup, 24px | Sidebar, drawer, mobile header |
| `<LogoMark>` | Orbital symbol alone | Tight surfaces; needs no theme variant |

### Regenerating the derivatives

If a new `logo.png` is supplied:

```bash
npm run logo:build
```

`scripts/build-logo.mjs` scans the source for non-transparent pixels to find
the artwork bounds and the gap between symbol and wordmark, then writes all
four derivatives plus the favicons. Because the bounds are measured rather than
hardcoded, a differently-cropped source works without editing the script.

If a version with a **dark or `currentColor` wordmark** is ever supplied, the
recolouring step becomes unnecessary — point `Logo` at that file directly and
delete the two `logo-full-*.png` variants.

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
