# Cafe POS redesign spec: "Guest Check"

Operate-mode app UI. The visual world is the waiter's green **guest-check pad**, made into clean software. It is a working till first: standard controls, clear hierarchy, dense where useful. The world only contributes type, palette, density and one signature move. **No costume:** no paper textures, torn edges, handwriting fonts, tilted paper, ruled-ledger backgrounds.

## Retired (remove wherever you find it)
- `glass` class, ambient glows, grain, `backdrop-blur` as decoration, `shadow-glow`, gradient backgrounds (`bg-gradient-*`, `linear-gradient` tints on tiles), oversized watermark icons, ripple/steam effects, `anim-tile`, `anim-rise`, `anim-bump`.
- The `display` utility still exists but now means "same family, bold, tabular" (use it for money/big figures only).
- CSS classes that no longer exist in globals.css: `.torn`, `.stub-perf`, `.ticket-rail`, `.docket*`, `.perf`, `.heat-*`, `.ambient`, `.grain`. Rewrite those UIs with Tailwind and the tokens below.
- Raw Tailwind palette colours (`rose-*`, `emerald-*`, `amber-*`, `sky-*`, `violet-*`, `teal-*`, `red-*`, `green-*` etc.), including `dark:` variants for them. Replace with the state tokens below (they already handle dark mode, so drop the `dark:` overrides).
- Pill everything: `rounded-full` only for genuinely round things (avatars, dots, toggle knobs, count badges). Otherwise use `rounded-lg` (6px) or `rounded-xl` (8px). `rounded-2xl` (10px) / `rounded-3xl` (14px) are now small, so they're fine but prefer `rounded-lg`/`rounded-xl`.

## Tokens (Tailwind classes; all work in light + dark automatically)
- Grounds: `bg-bg` (pale check-green app ground), `bg-surface` (white work panels), `bg-surface-2` (subtle row/footers), `bg-surface-3` (pressed/neutral fills).
- Lines: `border-line` (hairline), `border-line-strong` (control borders, emphasised rules).
- Ink: `text-ink`, `text-ink-2` (secondary), `text-muted` (tertiary; still AA on surface).
- Brand = printed green: `bg-brand text-on-brand hover:bg-brand-hover` (primary actions, selected states), `bg-brand-soft text-brand-ink` (soft selected), `text-brand-ink` (printed-green text: column heads, links, icons of emphasis).
- **Serial red** `text-serial` / utility `serial`: ONLY for order numbers (e.g. `#C-014`). Never for errors.
- **Ballpoint blue** `text-pen` / utility `pen`, `bg-pen-soft`: ONLY for text staff wrote for this order: modifiers chosen, item notes, order notes, customer name/phone/address, custom amounts, void/refund reasons typed by staff.
- State: `text-ok bg-ok-soft` (paid, ready, success), `text-warn bg-warn-soft border-warn-line` (attention, pending, late-ish), `text-bad bg-bad-soft` (errors, void, cancelled, destructive), `text-info bg-info-soft` (in kitchen / informational). Solid buttons: `bg-bad text-surface`, `bg-ok text-surface`, `bg-warn text-surface`.
- Never rely on colour alone for state: pair with an icon or word; you may also encode by line form (dashed border = pending/unsent/not synced, line-through = void).

## Type (one family: Archivo, already loaded as `font-sans`)
- UI body 14-15px; labels 13px semibold; section titles 16-18px bold `tracking-[-0.01em]`; page titles 20-22px bold.
- Utility `cond`: condensed uppercase printed column head (use via `<ColHead>` from `ui.tsx`, 11px, printed green). Use for table column heads, small section labels in lists (e.g. "QTY", "ITEM", "AMOUNT", "TABLE", "GUESTS", "SERVER", "PAID BY"). Do not put a label above every heading (no eyebrows/kickers above headings).
- Money: `tabular` (or `display` for big totals), right-aligned in columns.
- No `font-mono` costume; codes and numbers use `tabular` in the same family.

## Components (from `src/components/ui.tsx`, already restyled)
`Button` (primary/secondary/outline/ghost/danger/success/warning), `IconButton`, `Field`, `Input`, `Textarea`, `Select`, `Toggle`, `Segmented` (boxed cells, selected = filled green), `Badge` (tones gray/brand/green/amber/red/blue/violet → mapped to state tokens, square-ish), `Card` (white, hairline border, no shadow), `ColHead`, `EmptyState`, `Modal`, `Keypad`. Prefer these over hand-rolled equivalents; keep one vocabulary.

## Signature move: the guest check
Anywhere an order is shown as a document (register order panel, checkout summary, order detail), present it like a guest check, in clean UI form:
- Red serial order number (`serial` utility), e.g. `#C-014`, as the document's identity.
- A boxed header row of facts with hairline dividers (e.g. TYPE | TABLE | GUESTS | SERVER), each cell: `ColHead` label above a value.
- Column heads QTY · ITEM · AMOUNT (`ColHead`), lines separated by `border-line` hairlines, amounts right-aligned tabular.
- Modifiers/notes in `pen` (ballpoint blue).
- A `rule-double` (3px double rule in printed green) directly above the TOTAL row; the total in `display` bold.

## Surfaces & layout
- Panels/cards: `bg-surface border border-line rounded-xl`, no shadow (or `shadow-card` at most). Elevated overlays: `shadow-pop`.
- Page padding 12-20px; consistent gaps (8/12/16/24). Tight groups, generous separation; more space above a section heading than below.
- Lists/tables: real tables or divided lists with hairlines, sticky/printed-green column heads; hover `bg-surface-2`; selected row `bg-brand-soft`.
- Touch targets ≥ 44px for primary actions.
- Motion: 150-200ms colour/transform transitions only. Utilities available: `anim-pop`, `anim-sheet`, `anim-fade`, `anim-flash` (blue ballpoint highlight), `anim-line` (row slides in), `anim-press`.
- Empty states teach the next action.

## Rules for you
- Keep ALL behaviour, data flow, props, handlers, copy and accessibility intact; change presentation only. Do not rename exports or change component APIs.
- Do not edit `src/app/globals.css`, `src/components/ui.tsx`, `App.tsx`, `Register.tsx`, `OrderLines.tsx` (another person owns them). If you need a style, use Tailwind classes with the tokens above.
- After editing, run `npx tsc --noEmit -p .` from `D:\pos_divlynx` and fix any errors in your files. Then `grep` your files for leftovers: `glass|shadow-glow|gradient|rose-|emerald-|amber-|sky-|violet-|teal-|torn|docket|stub-perf|anim-tile|anim-rise|anim-bump|backdrop-blur` and remove them.
- Report briefly: files changed, notable design decisions, anything you could not resolve.
