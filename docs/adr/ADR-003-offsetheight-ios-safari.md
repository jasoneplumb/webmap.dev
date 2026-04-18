# ADR-003: offsetHeight for iOS Safari Snap-Points

**Status:** Accepted

## Context

The bottom sheet (information panel) on mobile has three snap points:
- **Peek** — Small handle visible, most of map exposed (72px from bottom)
- **Half** — Sheet occupies ~45% of viewport height
- **Full** — Sheet fills the viewport

To position the sheet correctly, the code needs to calculate its height and translate it off-screen via CSS `transform: translateY()`. The snap-point math depends on knowing the actual rendered height of the sheet element.

### The iOS Safari Problem

On iOS Safari, there is a critical discrepancy between two viewport measurements:
- **`window.innerHeight`** — Reflects the *currently visible* viewport (excludes the browser's bottom toolbar when it's visible)
- **CSS `vh` units** — Computed based on the *largest possible* viewport (includes virtual space for a hidden toolbar)

When the browser toolbar is shown (user scrolling), these two measurements can differ by 50–100 pixels. A sheet with CSS `height: 90vh` may render *taller* than `window.innerHeight * 0.9`, causing snap-point calculations to break:

```typescript
// Wrong approach
const h = Math.round(window.innerHeight * 0.9); // e.g., 900px
_el.style.transform = `translateY(${h}px)`; // may not align with actual rendered height
```

The sheet would render as 950px (due to `vh` calculation) but be told to translate 900px, leaving a visible gap or misalignment.

## Decision

Query the actual rendered height of the sheet element using **`element.offsetHeight`** instead of calculating from `window.innerHeight`:

```typescript
function fullHeightPx(): number {
  // Use the actual rendered height when the element exists in the DOM.
  // On older iOS Safari, CSS `90vh` and `window.innerHeight * 0.9` disagree
  // because `vh` is based on the largest possible viewport (toolbar hidden)
  // while `innerHeight` reflects the current visible viewport. Using
  // offsetHeight keeps snap-point math consistent with the rendered sheet.
  if (_el) return _el.offsetHeight;
  return Math.round(window.innerHeight * SHEET_VH);
}
```

## Alternatives Considered

1. **Always use CSS `vh` units without JavaScript calculation**
   - Position snap-points entirely in CSS media queries and CSS custom properties
   - Pros: Simpler, no JavaScript bridging
   - Cons: Hard to achieve dynamic snap-points that respond to gesture; CSS alone cannot implement smooth drag-to-snap behavior

2. **Always use `window.innerHeight` with a hardcoded iOS correction factor**
   - Add a platform-detection check and apply a +60px adjustment only on iOS
   - Pros: Works without querying the DOM
   - Cons: Brittle; correction factor differs by iOS version and orientation; breaks on non-mobile iOS browsers

3. **Measure viewport height at different lifecycle events (resize, orientationchange)**
   - Cache measurements and update them on viewport change
   - Pros: Avoid repeated DOM queries
   - Cons: Still requires logic to detect when cache is stale; doesn't solve the fundamental `vh` vs. `innerHeight` mismatch

4. **Use Intersection Observer or ResizeObserver to track sheet height changes**
   - Set up a ResizeObserver to monitor `offsetHeight` and update snap-points when it changes
   - Pros: Reactive; automatically handles dynamic content in the sheet
   - Cons: Overkill for static sheet dimensions; adds observer lifecycle management

## Consequences

### Advantages
- **Correctness:** Snap-points align perfectly with the rendered sheet, regardless of iOS Safari's toolbar state
- **Simplicity:** Direct DOM measurement; no platform sniffing or correction factors
- **Robustness:** Works across browser versions and orientations without hardcoded adjustments
- **Cross-browser compatibility:** Falls back gracefully to `window.innerHeight * 0.9` if the sheet element doesn't exist yet (e.g., during initialization)

### Disadvantages
- **DOM dependency:** Snap-point calculations require the element to be in the DOM; cannot calculate heights before the element is created
- **Performance:** `offsetHeight` triggers a reflow if any CSS or layout properties have changed since the last reflow; calling it during drag events (very frequently) could be costly
- **Assumptions:** Assumes the rendered height is always stable; if content changes dynamically, snap-points may need recalculation

### Mitigation
- Cache `offsetHeight` during initialization and only re-query after major layout changes (orientation, window resize)
- For drag events, use the cached value from the most recent snap-point transition to avoid repeated reflow triggers
- Add a `ResizeObserver` or `window.orientationchange` listener to update the cache if the sheet's height changes

## Related Decisions
- [ADR-001: Single Mutable State](ADR-001-single-mutable-state.md) — Sheet snap point state is stored in the mutable AppState object
