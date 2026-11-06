# Design: "Guest Check"

The till is the waiter's green guest-check pad, made into clean software. It's an operating tool first: standard controls, clear hierarchy, dense where useful. The world contributes only type, palette, density and one signature move. Tokens live in `src/app/globals.css`, and the primitives live in `src/components/ui.tsx`.

## Palette (CSS variables → Tailwind `bg-*` / `text-*` / `border-*`)

| Role | Token | Light | Dark | Use |
|---|---|---|---|---|
| Ground | `bg` | #e3ebdf | #0e1411 | App background (pale check-green stock) |
| Panel | `surface` | #ffffff | #161e19 | Work panels, cards, inputs |
| Subtle | `surface-2` / `surface-3` | #f4f7f2 / #e8eee5 | #1b241e / #222d26 | Column-head bands, hovers, pressed fills |
| Rules | `line` / `line-strong` | #d3ded0 / #a9bea5 | #2a372f / #3d5044 | Hairlines / control borders |
| Ink | `ink` / `ink-2` / `muted` | #16201a / #344439 / #5a6b60 | #e6eee7 / #c1cec4 / #8b9e91 | Text tiers |
| Printed green | `brand`, `brand-ink`, `brand-soft` | #24563b | #6bbf8d | Primary actions, selection, column heads |
| Rail | `rail`, `rail-ink`, `rail-on` | #1e4a32 | #0a100d | Nav rail and the lock-screen cover |
| Serial red | `serial` | #c4302a | #ff7b6f | **Order numbers only** |
| Ballpoint | `pen`, `pen-soft` | #2640a6 | #a3b4ff | **Only text staff wrote**: modifiers, notes, names, typed amounts and reasons |
| State | `ok` / `warn` / `bad` / `info` (+ `-soft`) | | | Paid/ready · attention · error/void · in kitchen |

Colour is never the only signal. State also changes line form: a dashed qty box means not sent yet, a dashed sync chip means pending, and line-through means void.

## Type

- **Family:** Archivo (variable, with a `wdth` axis), self-hosted via `next/font`. There's no second face.
- `cond`: condensed uppercase printed column heads (`<ColHead>`).
- `serial`: condensed red order numbers.
- `display`: bold tabular figures, for money and big numbers.
- **Scale:** UI text is 14–15px, labels 13px semibold, section titles 16–18px bold, page titles 20–22px.

## Shape and depth

- **Corners:** square-cut, set via overridden Tailwind radii. `rounded-lg` is 6px, `rounded-xl` 8px, `rounded-2xl` 10px. `rounded-full` is only for genuinely round things.
- **Depth:** flat. Panels use a hairline border and no shadow. Overlays use `shadow-pop` on a plain scrim, with no blur.

## Signature move: the guest check

Wherever an order is shown as a document (the register panel, the checkout slip, order detail), it has:

- the red serial number;
- a boxed facts row (TYPE | TABLE | GUESTS | SERVER) with hairline dividers;
- QTY · ITEM · AMOUNT column heads;
- modifiers and notes in ballpoint;
- a `rule-double` above TOTAL.

## Motion

Transitions run 150–200ms and convey state only:

- `anim-line`: a new line on the check;
- `anim-flash`: the ballpoint highlight on a changed line;
- `anim-press`: menu tile feedback;
- `anim-pop` / `anim-sheet`: dialogs.

Reduced-motion users get no animation.

## Retired: never reintroduce

Ambient glows, grain, glass and backdrop blur, gold glow shadows, gradient-tinted tiles, watermark icons, Unbounded/Figtree/JetBrains Mono, paper-docket and torn-receipt costumes, and raw Tailwind palette colours.

## Kept by request

The floor plan: tables drawn with chairs on a gridded floor (`.floor`, `.chair`).

## Theme

Light and dark are both first-class. The default is `system`, because the app runs all day under mixed light.
