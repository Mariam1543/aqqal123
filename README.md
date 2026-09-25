# Common Logistics Picture

A single operations screen for a land command. One page, no router, no navigation.
The map is the picture; everything else is a rail, a pane or an overlay around it.

It answers three questions: **what do we hold, how long would it last, and what needs
a decision.**

```bash
npm install
npm start      # http://localhost:4300
npm run check  # check-sim + check-render + check-plan
npm run sweep  # headless Chrome through every workspace, board, card and agent flow
```

## What it is

A standing readiness picture, not a battle simulation. Nothing on it is an operation
in progress. It is an instrument, not a document: labels rather than sentences,
figures first, prose behind an ⓘ toggle.

**Colour is spent on exceptions.** A screen where everything is fine is a screen with
almost no colour on it. A column of twenty green bars makes "fine" the loudest thing
on the screen, so status has two channels — `--st` is the ink on a figure read once,
`--st-fill` is the wash on figures that repeat, and only the wash goes neutral.

The theatre is fictional. Every figure on screen is derived by the simulation in
`server/sim.js`; the front end owns no data.

## Layout

```
public/
  index.html          the whole DOM skeleton — every region exists at load
  product.html        printable product sheet (own stylesheet, light, for print)
  symbols.html        the symbol set as a contact sheet
  styles.css          the single stylesheet
  theme/              drop-in token package for the sibling COP/CIP products
  js/                 one module per region; a module never reaches into
                      another's markup — cross-module effects go through the bus
server/
  seed.js             the theatre, as data
  sim.js              the endurance maths and the whole /api/clp payload
  decide.js           courses of action, the ladder, strike options, target folders
  agent.js            the decision agent and its card family
  index.js            Express: static public/ and the JSON API
scripts/
  check-sim.mjs       the model's arithmetic
  check-render.mjs    the real ES modules against a live snapshot, under a DOM stub
  check-plan.mjs      the plan assessor
  sweep.mjs           the real browser, end to end
```

No build step, no bundler, no framework, no CSS framework, no chart library. The files
you write are the files the browser runs. Leaflet, MapLibre, milsymbol and IBM Plex are
served from `public/vendor`, so the picture renders with no network beyond the tile
servers — and when the tile servers are unreachable, failed tiles paint the ground
colour and the chart still reads.

## Things that look like bugs and are not

- **The map opens with nothing on it.** Layers come on from the panel, a preset, a
  selection, or what the agent draws. An operator's first act is to say what they
  want to see.
- **A marker's second line is missing.** It appears on hover and on selection only.
  Forty table rows printed over the ground is not a map.
- **A green row has no green on it.** The wash goes neutral for repeated states.
- **The Selected tab disappears.** A task pane exists only while it holds something.
- **Decide's drawing vanishes when you switch tabs.** Decide's geometry belongs to
  Decide. The same is true of the mission layer.
- **Assessed things do not tick.** An assessment is a snapshot, not a return. They
  carry a confidence, never a status.
- **A figure stops updating while you are selecting text.** The poll defers its write
  until you release the selection; the as-of chip still says how current the picture is.
- **The rail is 320px but `--rail-w` says 304px.** The token is reserved for the
  sibling pictures. Do not "fix" one to match the other without changing both.

## Licence

Exercise material. Not for operational use.
