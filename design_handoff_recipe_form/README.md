# Handoff: Recipe Entry Form

## Overview
A manual recipe-creation form: title, author, prep/cook time, servings, difficulty, ingredients, instructions, an optional photo, and a tips/notes section. Single scrolling page, static (no client-side interactivity built — fields are visual/native HTML only, no JS validation or add/remove logic).

## About the Design Files
The bundled file (`Recipe Form.dc.html`) is a **design reference built in HTML** — a prototype showing intended layout, styling, and content, not production code to copy directly. Recreate this design in the target codebase's existing environment (React, Vue, native, etc.) using its established components and patterns. If no environment exists yet, choose the framework best suited to the project.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and copy are final/representative — recreate pixel-close using the codebase's existing design system components where they exist, falling back to the tokens below.

## Screens / Views
One screen: **Recipe entry form**.
- **Purpose**: User fills in a new recipe and either saves a draft or publishes.
- **Layout**: Single centered column, max-width 760px, generous vertical padding (64px top). Page header (kicker tag + H1 + subtitle) sits above a single card containing all fields, stacked vertically with consistent gaps.

### Components (top to bottom)
1. **Page header**: small pill tag "New recipe" (accent-tinted), H1 "Add a recipe to your collection" (display/heading font), muted subtitle paragraph, max-width ~480px.
2. **Card container**: rounded surface (elevated shadow), contains everything below, no padding on outer wrapper (children handle their own).
3. **Photo placeholder**: 280px-tall rounded rectangle, diagonal-stripe pattern, centered pill label "photo of the finished dish (optional)". Replace with a real image-upload control in production.
4. **Title field** (required, marked with `*`): label + large text input, heading-style font at ~22px.
5. **Author field**: label + standard text input.
6. **Meta row**: 4-column grid — Prep time (text), Cook time (text), Servings (text), Difficulty (select: Easy/Medium/Hard).
7. **Divider** (hairline rule).
8. **Ingredients field**: label + helper text ("One per line, including measurements") + multi-line textarea (6 rows), placeholder shows example lines.
9. **Instructions field** (required): label + helper text ("Walk through the steps in order") + multi-line textarea (10 rows), placeholder shows numbered example steps.
10. **Tips & notes**: visually distinct panel — tinted background (secondary accent, light tint), rounded, label + helper text + 3-row textarea.
11. **Footer actions**: right-aligned button row — "Save as draft" (secondary/outline button) and "Publish recipe" (primary filled button), separated from the fields above by a hairline top border.

### States
- Inputs: hover slightly darkens border; focus shows a 2px accent outline (no default browser blue ring).
- Buttons: primary is solid-fill; hover/active steps one shade darker on the accent ramp. Secondary is outlined/ghost with a subtle hover tint.
- Required fields marked with an accent-colored asterisk only — no live validation implemented (static prototype).

## Interactions & Behavior
None implemented — this is a static layout. Production build should add:
- Form validation (Title and Instructions required).
- Image upload/drag-drop for the photo slot.
- Possibly dynamic add/remove rows for ingredients if the target product wants structured (qty/unit/name) entry instead of free text.
- Save-as-draft vs publish submit behavior (persistence, routing).

## State Management
Not implemented in the prototype. Suggested shape for implementation:
```
{ title, author, prepTime, cookTime, servings, difficulty, ingredientsText, instructionsText, notes, photoFile }
```

## Design Tokens
From the bound "Organic" design system (`styles.css`):
- **Colors**: bg `#f5ead8`, surface `#ebddc5`, text `#201e1d`, accent (terracotta) `#c67139`, accent-2 (sage) `#7a8a5e`. Each accent has a 100–900 tonal ramp (see `styles.css`).
- **Typography**: headings — "Caprasimo" (display serif-ish, weight 400); body — "Figtree". Type scale: h1 42px, h2 32px, h3 25px, h4 20px, body 15px/1.55.
- **Spacing scale**: 4.4 / 8.8 / 13.2 / 17.6 / 26.4 / 35.2px (`--space-1..8`).
- **Radius**: sm 8px, md 16px, lg 28px (buttons/inputs/tags rounded to pill, 999px).
- **Shadows**: sm/md/lg — soft ink-tinted, tuned to the warm light ground.
- Full token definitions and component classes (`.btn`, `.field`, `.input`, `.card`, `.tag`) are in `styles.css`.

## Assets
No photographs used — the photo slot is a CSS stripe-pattern placeholder (no image asset to hand off). No icons used.

## Files
- `Recipe Form.dc.html` — the design source (inline-styled HTML using the design-system's CSS classes).
- `styles.css` — the design system stylesheet (tokens + component classes) the form is built on.
