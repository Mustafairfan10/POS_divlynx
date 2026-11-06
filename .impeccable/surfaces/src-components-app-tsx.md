---
version: 1
slug: "src-components-app-tsx"
primary_target: "src/components/App.tsx"
related_targets: ["src/components/views"]
---

# Surface brief: Cafe POS app (all screens)

Scope: every working screen of the app (login/setup, Register, Checkout, Orders, Tables, Kitchen, Menu, Reports, Settings, modals). Mode: Operate.
Audience/job: counter and floor staff ringing up orders by touch, managers approving and reading reports, kitchen watching tickets. Mixed light all day: light and dark both first-class, system picks.
Constraints: keep every feature, flow and copy; full visual redesign; keep the floor plan's tables-with-chairs; the Espresso Bar look (glows, grain, glass, gradient tiles, watermark icons, Unbounded, gold glow) is retired.

## Direction contract

THESIS: The till is the waiter's guest-check pad made into software: every order is the next numbered check. Refuses the category default of white cards + one blue charge button, and the dark-espresso-with-gold-glow café cliché.

OWN-WORLD: Pale check-green stock (#E4ECE1) as the ground, white "carbon copy" work panels, printed-green ink (#24563B) for rules, column heads and the nav rail, red serial numerals (#C8322B) only for order numbers, ballpoint blue (#2742A8) only for what staff wrote (modifiers, notes, names, custom amounts). Archivo throughout: condensed caps for column heads and serials, normal width for UI, tabular figures for money. Flat, hairline-ruled; no texture, no glass, no glow, no gradients. Dark: carbon green-black ground, same roles relit.

STORY: Staff see the menu, tap items, and watch the check fill in: they always know which check they are on (red number), who it's for (boxed header), what's still unsent (dashed rule), and what is due (double-ruled total). They pay or send in one tap.

FIRST VIEWPORT: Register at 1366x860. Left: 72px printed-green nav rail. Centre: search + category tabs, then a fixed grid of white item tiles (name top, price bottom-right, tabular). Right: 400px check panel: red serial "No. C-014" condensed, boxed TABLE | GUESTS | SERVER row, QTY / ITEM / AMOUNT column heads, lines with blue modifiers, pinned totals with a double rule over TOTAL, then Send and a green Pay button full width.

FORM: Guest Check Pad, position 1 on my ordered list (IMPECCABLE'S PICK, chosen by the user over the rolled Hotelware). seed:4ed903e942707277. Signature move: the order panel as a guest check (serial, boxed header, columns, double-ruled total) plus ballpoint blue for staff-entered text. Motion: 150-200ms state transitions only; a new line item slides in under the column heads.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
