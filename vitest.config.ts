import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // clones/ holds git worktrees of this same repo (see .gitignore), so their src/
    // directories carry copies of every test file here. Without this exclude a local
    // `npm test` collects them all and reports a multiple of the real count — 926
    // "passing" tests against 391 actual ones on 2026-09-14, which is worse than
    // noise: it is a number people quote in PR descriptions. CI is unaffected, since
    // it checks out clean, so the two disagreed silently.
    //
    // Spread rather than replace: assigning `exclude` overrides Vitest's defaults
    // outright, which would quietly drop its exclusions for cypress/, dotfolders and
    // config files matching the test glob — none present today, all silent when added.
    exclude: [...configDefaults.exclude, 'clones/**'],
  },
});
