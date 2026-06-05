/**
 * Intent: First-run consent modal — blocks app usage until terms are accepted
 * Context: Called by main.ts at load time; re-prompts when CONSENT_VERSION changes
 * Pattern: Returns a Promise that resolves true (accepted) or false (declined); no AppState dependency
 */

const CONSENT_VERSION = '2.2';
const KEY_VERSION = 'webmap-consent-version';
const KEY_ACCEPTED_AT = 'webmap-consent-accepted-at';
const KEY_INSTALL_ID = 'webmap-consent-install-id';

export function hasConsent(): boolean {
  return localStorage.getItem(KEY_VERSION) === CONSENT_VERSION;
}

function ensureInstallId(): void {
  if (!localStorage.getItem(KEY_INSTALL_ID)) {
    localStorage.setItem(KEY_INSTALL_ID, crypto.randomUUID());
  }
}

function recordConsent(): void {
  ensureInstallId();
  localStorage.setItem(KEY_VERSION, CONSENT_VERSION);
  localStorage.setItem(KEY_ACCEPTED_AT, new Date().toISOString());
}

export function showConsentModal(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'consent-overlay';

    const panel = document.createElement('div');
    panel.id = 'consent-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Welcome to webmap.dev');
    panel.innerHTML = `
      <h2>webmap.dev — privacy-first GPS mapping, no account required</h2>

      <div id="consent-body" tabindex="0" aria-label="Terms — scroll to read">
        <h3>Privacy Policy</h3>
        <ul class="consent-legal">
          <li><strong>Local only.</strong> All GPS data and app settings stay in your browser. Nothing is sent to our servers.</li>
          <li><strong>No tracking.</strong> No analytics, cookies, or tracking pixels.</li>
          <li><strong>Third-party services.</strong> Map tiles load from OpenStreetMap servers. Address search uses the Esri ArcGIS geocoding API. These services may log standard HTTP request data per their own policies.</li>
          <li><strong>Turn-by-turn routing.</strong> When you tap "Navigate here", your current location and destination are sent to the FOSSGIS Valhalla service to compute a route. No location data is transmitted except as described above.</li>
          <li><strong>Stored items.</strong> The app stores a consent record and an anonymous install ID in localStorage.</li>
          <li><strong>Deletion.</strong> Clear your browser's site data for webmap.dev to remove everything.</li>
        </ul>

        <h3>Terms of Use</h3>
        <ol class="consent-legal">
          <li>This app is for <strong>personal, non-commercial</strong> map viewing and GPS-based navigation.</li>
          <li>The app is provided <strong>as-is with no warranty</strong>. GPS accuracy varies and routing directions may be incorrect. Do not rely on this app as your sole navigation source, or for emergency response or safety-critical decisions.</li>
          <li><strong>You are responsible</strong> for your own safety. Pay attention to your surroundings and obey local laws.</li>
          <li>To the maximum extent permitted by law, the developer is <strong>not liable</strong> for any damages arising from use of this app.</li>
          <li>These terms may be updated. Material changes will require re-acceptance.</li>
        </ol>
      </div>

      <div id="consent-actions">
        <p id="consent-scroll-hint">Please scroll to the bottom to continue.</p>
        <button id="consent-accept" class="rec-btn rec-btn-start" disabled>I agree — continue</button>
        <button id="consent-decline">Decline</button>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const acceptBtn = panel.querySelector<HTMLButtonElement>('#consent-accept')!;
    const body = panel.querySelector<HTMLElement>('#consent-body')!;
    const hint = panel.querySelector<HTMLElement>('#consent-scroll-hint')!;

    // Gate the accept button on the user having scrolled to the bottom of the terms.
    // Enable as soon as the bottom is reached (4px tolerance for sub-pixel rounding),
    // or immediately if the terms are short enough not to scroll. Re-checked on resize
    // so a rotate that makes the content fit also unlocks it.
    const atBottom = (): boolean =>
      body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
    const unlock = (): void => {
      acceptBtn.disabled = false;
      hint.style.display = 'none';
      body.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
      // Move focus to the now-interactive button so a keyboard user who just scrolled
      // to the bottom doesn't have to Tab forward to reach it.
      acceptBtn.focus();
    };
    const onScrollOrResize = (): void => {
      if (atBottom()) unlock();
    };

    if (atBottom()) {
      unlock();
    } else {
      hint.style.display = 'block';
      body.addEventListener('scroll', onScrollOrResize, { passive: true });
      window.addEventListener('resize', onScrollOrResize);
    }

    function cleanup(accepted: boolean): void {
      // Symmetric teardown — tear down both listeners regardless of which path closes
      // the modal (e.g. decline-before-scroll leaves the scroll listener attached).
      body.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
      overlay.remove();
      if (accepted) recordConsent();
      resolve(accepted);
    }

    acceptBtn.addEventListener('click', () => cleanup(true));
    panel.querySelector('#consent-decline')!.addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        cleanup(false);
      }
    };
    document.addEventListener('keydown', onKey);

    // Focus the scrollable terms so keyboard users can scroll to read (and thereby
    // unlock the accept button, which starts disabled and can't take focus yet).
    body.focus();
  });
}
