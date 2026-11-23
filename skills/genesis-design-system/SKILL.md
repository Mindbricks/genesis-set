---
name: genesis-design-system
description: Choose and apply the design system the frontend of a genesis project follows, from the Genesis catalog of style references (genesis_listDesignSystems, genesis_applyDesignSystem), and hand it to the frontend work. Use it before any frontend or UI work in a genesis project, when design/DESIGN_SYSTEM.md is missing at the frontend step, and when the user asks for a look, a theme, a style or a design system. Do not use it to design the backend (the mind-set openappl-blueprint-* skills) or to compile (genesis-compiler-api).
---

# The design system of the frontend

One design system keeps every screen of the frontend in one visual language, whichever agent or
subagent writes it. Genesis serves a catalog of style references: per system its tokens (colors,
typography, spacing, radii, elevation), components, imagery rules, do's and don'ts and a prompt
guide for agents. The project follows exactly one, in `design/DESIGN_SYSTEM.md`.

The two tools and their REST routes are in `{{CORPUS}}/genesis/compiler-api.md` (sections 4 and 9).

## When

- Before the first frontend or UI work of the project, after `design/frontend-spec.md` exists
  (or after the user said what the frontend is for, when the design was skipped).
- When the user asks for another look. Otherwise a project that has `design/DESIGN_SYSTEM.md`
  keeps it: follow it, do not propose a new one.

## Steps

1. **Read what the frontend is for.** `design/frontend-spec.md`: the users, the platform (web,
   mobile web, admin tool), the tone, how dense the screens are, light or dark. Without it, ask
   the user at most three short questions: who uses it, what mood (calm, playful, premium,
   technical), light or dark.
2. **List the catalog:** `genesis_listDesignSystems` (optionally one `theme`). The compact rows
   carry the slug, name, tagline, theme, similar brands and two key colors. Shortlist from
   them, then call it again with `slugs` for the summaries and colors of your shortlist.
3. **Propose five.** Pick the five that fit best and show each as: name, theme, the tagline, and
   one reason tied to the spec ("dense tables and a dark theme for an operations console").
   Different characters, not five variants of one look. Say that any other system of the
   catalog can be named too, and that the board shows the choice once applied.
4. **The user picks.** Never pick silently. If the user declines all of them, say once that the
   screens will be less consistent, and go on without one.
5. **Apply:** `genesis_applyDesignSystem` with the slug. It writes `design/DESIGN_SYSTEM.md`
   (replacing a previous one) and the board shows it under Overview, Design system.

## Using it in the frontend work

- Every frontend brief (yours or a subagent's) includes `design/DESIGN_SYSTEM.md` next to
  `design/frontend-spec.md` and the API contract (openappl-blueprint-contract). Read its Agent
  Prompt Guide and Quick Start first, then the tokens.
- Put the tokens into one place in the frontend (CSS variables or the theme of the UI library)
  and use them everywhere; no ad-hoc colors or sizes.
- **A style reference, not a brand.** The systems are named after products whose look they
  describe. Take the look, never the brand: no brand name, logo, mascot, product photography or
  copy in the user's product, and no proprietary font. Use the fallback fonts the file names, or
  a freely licensed font of the same character. The product keeps its own name and identity.
- The user may edit `design/DESIGN_SYSTEM.md`; edits stay until another system is applied.
