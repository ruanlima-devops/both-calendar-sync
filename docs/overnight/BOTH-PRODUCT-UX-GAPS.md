# BOTH Product UX Gaps — 2026-11-23

## Fixed overnight (local)
- Email/password login & signup (replaces “em breve”)
- Forgot / confirm / update password flows
- Onboarding progress indicator + loading connect + recoverable errors (web-safe)
- Block finish without calendars / without enabled calendars
- First-run “Pronto” confirmation copy
- Paywall `?canceled=1` user notice
- Settings “Alterar senha”
- PT `+not-found`

## Fixed overnight (follow-up)
- `calendars.tsx`: `Alert.alert` → `confirmAction`/`showMessage` (web-safe disconnect/errors). Overlaps PR #15 calendars hunk — serialize merge.

## Remaining high-impact UX gaps
1. Agenda/calendars first-fetch loading skeletons missing.
2. Week/month empty states weaker than day view.
3. Legal copy still marked pending review.
4. OAuth error mapping for ticket flow lives in PR #15 — not on develop.
5. No in-app “first sync running/failed/retry” live status beyond onboarding copy (needs sync job UI).
6. Other screens still use raw `Alert.alert` (settings/scheduling/availability/event) — lower priority than calendars.

## Design system
- Reused existing `AuthShell`, `Button`, `theme` tokens — no new branding.
