# Per-brand icons

`next` copies all of `public/` verbatim into every build, so a single root
`favicon.ico` gets served by both domains. That is why torofluxindustries.com
showed the Metflux mark in Google search results.

Each brand therefore keeps its own set here, and `scripts/build-brand.mjs`
copies the active brand's files to the **root** of `out-<brand>/` after the
build, deleting the shared root icons first. The root matters: browsers and
Google fetch `/favicon.ico` by convention even when no `<link>` points at it.

The files in `public/` root are Metflux's copies, used only by `next dev`.

There is deliberately **no `favicon.svg`**. The one that used to be served was
starter-template art — an eight-petal flower, the same "Pulse Robot" template
that `public/logo.svg` still comes from — and was neither company's logo.
`favicon.svg` stays in the build script's delete list so a stray copy can
never reach a live domain again.

## Files per brand

| File | Size | Purpose |
|---|---|---|
| `favicon.ico` | 16 + 32 + 48 | required; what Google's crawler fetches |
| `favicon-32.png` | 32 | modern browser tabs |
| `favicon-192.png` | 192 | Android home screen |
| `apple-touch-icon.png` | 180, opaque | iOS home screen (no alpha — iOS won't composite) |

Adding a brand: create `public/icons/<brand>/` with at least `favicon.ico`,
and add its theme colour to `BRAND_THEME_COLOR` in `pages/_app.tsx`.

## Sources

Metflux: `logo/LOGO-01.png` — the green/grey angular mark, trimmed to its
opaque bounds and padded to a square.

## How Toroflux's mark was derived

`logo-toroflux/toroflux-logo.png` is a wide lockup — the wordmark "Toroflux"
where the first "o" is the blue toroid symbol. A favicon needs a square mark,
so the toroid was isolated by connected-component analysis: take the one
component containing blue pixels, then keep every other component that lies
entirely within 1.45x the blue radius (the centre dot and the radiating rays)
and discard the neighbouring "r" and "f" glyphs.

Two masters are committed:

- `symbol.png` — toroid + centre dot + rays. Used at 48px and above.
- `symbol-simple.png` — rays dropped. Used at 16 and 32, where the hairline
  rays smear into an unreadable grey blob.

Both are ~93px, the limit of the source art. Re-render from a vector or a
higher-resolution Toroflux logo if one becomes available — the 180px
apple-touch icon is upscaled and slightly soft.
