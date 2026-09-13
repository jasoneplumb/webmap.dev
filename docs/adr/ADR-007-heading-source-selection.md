# ADR-007: Heading source follows motion state

- **Status:** Accepted
- **Date:** 2026-09-13
- **Issue:** [#310](https://github.com/jasoneplumb/webmap.dev/issues/310)
- **Prototype:** `.tux/prototypes/orientation-indicator.html` (TUX `protodir`)

## Context

The app had two sources of directional information and no relationship between them.

`location.ts` rotated the blue dot's heading cone from the GPS course (`e.heading`). That value is `NaN` below roughly walking pace, so the cone held its last bearing for 10 s and then hid rather than keep pointing somewhere stale.

`compass.ts` subscribed to a true-north device heading and spent it rotating its own 38 px rose glyph. Nothing else consumed it.

The result was that a rider stopped at a junction — the exact moment someone looks down to work out which way they are facing — saw no direction at all, while the device sat there knowing the answer. The compass also stayed off until the user found and tapped that rose, an undiscoverable gesture for something most mobile users would want on.

## Decision

**One heading is drawn, and motion state picks its source.** `selectHeading()` in `heading.ts` resolves, in order:

1. Moving at or above `STATIONARY_SPEED_MS` (0.5 m/s) with a valid course → **GPS course**.
2. A compass reading available → **device compass**.
3. A course newer than `HEADING_HOLD_MS` (10 s) → **held course**.
4. Otherwise → **nothing drawn**.

Rule 1 ignores the compass even when it is available. While moving, the phone can face somewhere other than the direction of travel — bar bag, jersey pocket, held sideways at a junction — and travel is the answer the user wants then. Rule 3 is only reachable without a compass, and exists so devices that deny or lack orientation behave exactly as they did before this change.

**The indicator is a ring around the position, not a cone behind it.** A faint bezel persists once any heading exists; only the bright arc and arrowhead move. Compass headings are drawn amber and travel headings blue, because "where the device points" and "where you are going" are different claims and should not be made in the same voice.

**The permission grant rides on the consent tap.** iOS ignores `DeviceOrientationEvent.requestPermission()` outside a user gesture, so a compass that is on by default is impossible without a tap somewhere. Rather than add one, the first-run consent modal carries a preselected compass row and fires the request from inside its accept handler.

**The map still does not rotate.** Only the indicator does. That trade-off from [ADR-006](ADR-006-routed-guidance.md) stands.

## Consequences

**Good.** A stationary user gets a direction for the first time. The heading the compass was already producing now does something. Shortest-arc interpolation means a compass crossing north turns 20° forward instead of sweeping 340° backward, and low-passing the magnetometer stops both the ring and the rose from shivering at rest.

**Costs.** `CONSENT_VERSION` moved to 2.3, so every existing install re-accepts once. The modal asks for a device sensor it did not ask for before, which the terms' own material-change clause covers, and re-acceptance is the only path by which an existing install picks up the preselected grant instead of staying on the tap-the-rose route this change exists to remove.

A `filter`-free indicator was chosen partly to stay clear of the iOS WebKit compositing-layer freeze documented in `style.css` and [#223](https://github.com/jasoneplumb/webmap.dev/issues/223); the ring is a masked `conic-gradient` plus a rotated triangle, the same compositing profile the cone already had.

Two clocks now drive one element — fixes at about 1 Hz, orientation at about 60 Hz — which is why the drawing lives in `heading-indicator.ts` rather than in `location.ts`, and why orientation-driven updates are coalesced to one write per frame.

Filtering happens in two stages on purpose: `compass.ts` low-passes the raw magnetometer to reject noise, and `heading-indicator.ts` eases the drawn angle toward whichever source won. Those are different jobs, and one time constant cannot serve both.

## Alternatives considered

**Draw both directions** — a travel arrow plus a faint facing tick. Rejected: two directions on a 14 px dot read as clutter at exactly the glance the indicator exists for. The prototype surfaces the divergence in a readout so the case is visible, without drawing it.

**Keep the cone and only extend its source.** Rejected: the cone's disappearance was half the problem. A user cannot tell "no direction available" from "the indicator is broken" when the element itself vanishes.

**Auto-request orientation on first map interaction.** Rejected as gesture hijacking — it spends a tap the user aimed at the map on a permission prompt they did not ask for.

**Leave the grant on the rose and document it better.** Rejected: the requirement is a compass that works for mobile users by default, and documentation does not change what happens when nobody taps the rose.
