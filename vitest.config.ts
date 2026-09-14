import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // clones/ holds git worktrees of this same repo (see CLAUDE.md), so their src/
    // directories carry copies of every test file here. Without this exclude a local
    // `npm test` collects them all and reports a multiple of the real count — 926
    // "passing" tests against 391 actual ones on 2026-09-14, which is worse than
    // noise: it is a number people quote in PR descriptions. CI is unaffected, since
    // it checks out clean, so the two disagreed silently.
    exclude: ['**/node_modules/**', '**/dist/**', 'clones/**'],
  },
});
