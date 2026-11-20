# Brand logos

The site loads `logos/transparents/*.png`. These are PNGs with the backgrounds
already removed, so they sit directly on the page with nothing behind them: no
plates, no blend modes.

## Dark mode

Every mark is drawn in dark ink for a light page, so the light theme needs no
treatment at all. In dark mode the stylesheet inverts the whole set at once:

```css
[data-theme="dark"] .logos img{ filter: invert(1) }
```

That is the entire dark-mode story. No per-logo class is needed, and nothing has
to be kept in step by hand when a logo is added or removed.

An earlier version used a `.logo--invert` class for the two marks drawn in
white, applied in the light theme with dark mode left alone. That has been
removed: inverting everything in dark mode is simpler, and it means a new logo
needs no decision about which class it wants.

The strip itself is in the brand bar under the hero: the list appears twice and
the track scrolls exactly -50%, so the loop is seamless. Opacity is 72% at rest
and lifts to 100% on hover, in both themes.
## In the strip

| File | Brand |
|---|---|
| `cbc4dc73...png` | Gul Ahmed |
| `e0e6dac3...png` | Bonanza Satrangi |
| `67529487...png` | Khaadi |
| `4146ad76...png` | Outfitters |
| `1146fa89...png` | Maria B |
| `b146906c...png` | edenrobe |
| `0be2ca82...png` | Almirah |
| `eb1eaceb...png` | Dhanak |
| `363f30e6...png` | Nuraan |

## Three files present but not used

- **`aab931da...png`** and **`740b8622...png`**, Diners and Almera, were removed
  from the strip on request. The files are still in this folder.
- **`0212d2c5...png`** is the Shopify logo. Shopify is the platform Verafo runs
  *on*, not a client, so listing it as a customer misstates the relationship.
- **`0e69f83b...png`** is the Khass poster. It carries a second Nakshatra Jewels
  mark at the bottom of the frame, so used as-is it would put two brands in one
  slot. Crop it to just the Khass wordmark and it can go in.

## Adding a logo

1. Put the transparent PNG in `logos/transparents/`.
2. Add an `<li>` to **both** `<ul class="logos">` lists in `index.html` — the
   visible one and the `aria-hidden` copy. They must stay identical or the loop
   will jump.

Nothing else is needed. There is no per-logo class to set.

## Before this goes live

Confirm every brand here has agreed to be listed. The names on the homepage
include some of the largest fashion retailers in Pakistan. If one is not a
customer, or is a customer who has not consented to their mark being used
publicly, remove that pair of `<li>` elements.

False endorsement of a registered trademark is actionable, the Competition
Commission of Pakistan treats misleading association claims as deceptive
marketing, and Verafo's product is trustworthiness with other people's data.
