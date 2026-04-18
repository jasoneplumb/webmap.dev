# Contributing to webmap.dev

Thank you for your interest in contributing to webmap.dev! This guide explains our development process, code standards, and how to submit changes.

## Getting Started

### Prerequisites

- **Node.js** 18 or later
- **Git**
- A fork of [webmap.dev](https://github.com/jasoneplumb/webmap.dev)

### Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/webmap.dev.git
cd webmap.dev

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Visit http://localhost:5173 in your browser. The app hot-reloads on file changes.

For detailed setup instructions, see [docs/development.md](docs/development.md).

## Before You Start

1. **Check for existing issues**: Search [GitHub Issues](https://github.com/jasoneplumb/webmap.dev/issues) to avoid duplicate work
2. **Create an issue first**: Open an issue describing the bug or feature before starting work
3. **Comment on the issue**: Let maintainers know you're working on it to avoid conflicts

## Workflow

### 1. Create a Feature Branch

Use this naming convention:

```bash
# For features
git checkout -b feature/issue-NUMBER-description

# For bugs
git checkout -b fix/issue-NUMBER-description

# For refactoring
git checkout -b refactor/issue-NUMBER-description
```

Example:
```bash
git checkout -b feature/111-add-security-docs
```

### 2. Make Your Changes

- Work in `src/` for application code
- Update `CHANGELOG.md` with a brief entry (see existing entries for format)
- Add comments only if behavior is non-obvious

### 3. Quality Gate

Before committing, run the project's verification suite:

```bash
npm run type-check   # TypeScript validation (strict mode)
npm run lint         # ESLint checks
npm run build        # Production build
```

All checks must pass. Fix any errors before proceeding.

### 4. Commit

Write clear, concise commit messages:

```bash
# Good
git commit -m "Add reverse geocoding for map pins"

# Good
git commit -m "Fix GPS accuracy filter on iOS Safari"

# Avoid
git commit -m "update stuff"
```

- Use imperative mood ("Add", "Fix", "Update")
- Reference the issue: "Closes #111" in the commit message
- Keep commits focused — one logical change per commit

### 5. Create a Pull Request

Push your branch:

```bash
git push origin feature/111-add-security-docs
```

[Create a PR](https://github.com/jasoneplumb/webmap.dev/compare) with:

- **Title**: Clear, <70 characters (e.g., "Add SECURITY.md and CONTRIBUTING.md")
- **Description**: Explain *why* the change is needed, not just *what* changed
  - Reference the issue: "Closes #111"
  - Include steps to test manually if applicable
- **Labels**: Add relevant labels (e.g., `enhancement`, `bug`, `documentation`)

Example PR body:

```markdown
Adds SECURITY.md and CONTRIBUTING.md to document project policies and development workflow.

Closes #111

**Testing**
- [ ] Type-check passes
- [ ] Lint passes
- [ ] Build succeeds
- [ ] Manual review of security documentation
```

### 6. Review & CI

- GitHub Actions will run type-check, lint, and build automatically
- Address any review feedback by pushing new commits (do not force-push)
- Once approved and CI passes, a maintainer will merge your PR

## Code Conventions

### TypeScript

- **Target**: ES2020 (no ES2022+ features like `Error.cause` or top-level await)
- **Strict Mode**: All files use `strict` mode; no `any` types
- **Type Annotations**: Required for function parameters and return types
- **Imports**: Use ES modules; avoid default exports in shared modules

Example:

```typescript
// Good
export function appendTrailPoint(
  latlng: L.LatLng,
  speed: number,
  state: AppState,
  map: L.Map
): void {
  // ...
}

// Avoid
export default function appendTrailPoint(latlng, speed, state, map) {
  // ...
}
```

### Code Style

- **Formatting**: Use ESLint (runs automatically with `npm run lint`)
- **Comments**: Add comments only for non-obvious logic; code should be self-documenting
- **Naming**: Use camelCase for variables/functions, PascalCase for types/classes
- **No dead code**: Remove unused imports, variables, and functions

### Testing

- Unit tests use **vitest** (e.g., `src/geocoding.test.ts`); run with `npm test`
- Verify changes with manual browser testing
- For GPS/location features, test on a real device if possible
- Check both desktop and mobile viewports (use Chrome DevTools mobile emulation)

### Architecture

For a deep-dive on the codebase architecture, see [docs/architecture.md](docs/architecture.md). Key concepts:

- **Single AppState**: All app state lives in one mutable object (see `src/types.ts`)
- **No Redux/Context**: State is threaded by reference through modules
- **GPS Refcount**: GPS polling is reference-counted — `locate` and `recording` independently request/release GPS watching
- **Service Worker**: Offline tiles are cached via workbox; strategy is cache-first with network fallback

## File Structure

```
src/
  main.ts              # Entry point, consent gate, locate button, recording controls
  types.ts             # AppState interface
  map.ts               # Leaflet initialization, tile layers
  controls.ts          # Toggle button factory, label collapse helper
  location.ts          # GPS handlers, haversine filter, blue dot
  timer.ts             # GPS polling loop
  geocoding.ts         # ESRI address search + reverse geocoding
  recording.ts         # Trail recording state machine, stats, GPX export
  bottom-sheet.ts      # Mobile bottom sheet / desktop side panel
  layers-control.ts    # Custom layers popover (base maps + overlays)
  offline-download.ts  # Region pre-download for offline tile caching
  consent.ts           # First-run consent modal (privacy + terms)
  battery.ts           # Battery drain estimation during recording
  trail-backup.ts      # Crash recovery backup for in-progress trails
  sw-constants.ts      # Service worker cache name constants
  style.css            # Styles

docs/
  architecture.md      # Detailed architecture and design patterns
  development.md       # Dev environment setup and file walkthrough
  features.md          # User-facing feature documentation
  deployment.md        # CI/CD, nginx, and deployment guide
```

## Common Tasks

### Adding a New Feature

1. Create an issue describing the feature
2. Create a feature branch: `git checkout -b feature/111-new-feature`
3. Add TypeScript types to `src/types.ts` if adding state
4. Implement the feature in the appropriate module (or new module)
5. Run quality gate: `npm run type-check && npm run lint && npm run build`
6. Commit with clear message: `git commit -m "Add new feature"`
7. Update CHANGELOG.md
8. Create a PR referencing the issue

### Fixing a Bug

1. Create an issue describing the bug (if not already open)
2. Create a fix branch: `git checkout -b fix/111-bug-description`
3. Write a failing test case (if applicable) or clear steps to reproduce
4. Fix the bug
5. Verify the fix doesn't break other features
6. Run quality gate
7. Commit: `git commit -m "Fix bug description"`
8. Create a PR

### Refactoring

- Keep refactors focused; do not mix refactoring with feature additions
- Run quality gate after each small refactor
- Write a clear PR description explaining *why* the refactor improves the codebase
- Add the `refactoring` label to your PR

## Questions?

- **How do I...?** Check [docs/development.md](docs/development.md)
- **How does X work?** Check [docs/architecture.md](docs/architecture.md)
- **What features exist?** Check [docs/features.md](docs/features.md)
- **How is it deployed?** Check [docs/deployment.md](docs/deployment.md)
- **I found a security issue**: See [SECURITY.md](SECURITY.md)
- **I'm stuck**: Comment on your GitHub issue; maintainers will help

Thank you for contributing! 🎉
