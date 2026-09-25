# CLP theme — hand-off note

Two files, one source of truth: `clp-theme.css` for anything that renders in a browser,
`clp-theme.json` for everything else. The JSON is generated from the CSS, so they cannot drift.

## How to use it

```html
<link rel="stylesheet" href="/theme/clp-theme.css">
<link rel="stylesheet" href="/your-product.css">
```

Address the tokens, never the values. `color: var(--bad)` is correct; `color: #cf5449` is a bug
that will survive the next palette change and quietly go wrong in the light theme.

## The three rules that actually matter

**1. Status has two channels, and people get this wrong.**

`--st` is the status *ink*: it colours a word, a pill, a single figure — somewhere green is said
deliberately and read once. `--st-fill` is the status *wash*: it colours the areas that repeat
down a table or a column of bars, where a normal state must recede. Only the wash goes neutral.

A column of twenty green bars makes "fine" the loudest thing on the screen. That is the failure
this rule exists to prevent.

The corollary is already in the stylesheet: `.st-fig { color: var(--st) }` but
`.st-fig.st-GREEN { color: var(--ink) }` — a repeated figure that is fine reads as plain ink.
One-off figures keep `.st-txt` and stay green.

**2. Affiliation is not status.**

`--hostile` says whose it is. `--bad` says how it is doing. An assessed opposing system is drawn
in `--hostile` and carries a *confidence*, never a status, because we do not see their returns.
Mixing the two produces a screen where a healthy enemy and a failing depot look identical.

There is one non-status pseudo-status, `st-ACCENT`, which resolves `--st` to `--accent`.
It means "this is a thing, not a state".

**3. Colour is spent on exceptions.**

A screen where everything is fine should have almost no colour on it. If your product's resting
state is colourful, the tokens are being used as decoration and the palette will stop working
the moment something is actually wrong.

## The type scale

This file carries the earlier, one-notch-smaller scale:

| Token | This file | The CLP application |
| --- | --- | --- |
| `--fs-micro` | 9.5px | 10px |
| `--fs-label` | 10px | 10.5px |
| `--fs-cap` | 11.5px | 12.5px |
| `--fs-body` | 12.5px | 13.5px |
| `--fs-val` | 12px | 13px |
| `--fs-title` | 13.5px | 15px |

The application went up a notch in a deliberate reading pass. **If you port this file, port the
scale with it** — do not mix the two, or labels from one product will sit a half-pixel off
labels from the other on the same wall.

Labels are the only uppercase: 10px / 500 / `letter-spacing: .09em`, colour `--mute`, written
sentence-case in the markup and uppercased by CSS so the accessible name stays readable.

## Known inconsistency

`--rail-w` is 304px and the CLP drawer is 320px. The token is reserved so the sibling products
stay in step; the drawer does not read it. Do not "fix" one to match the other without changing
both products.
