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

      <div id="consent-body">
        <h3>Privacy Policy</h3>
        <ul class="consent-legal">
          <li><strong>Local only.</strong> All GPS data and app settings stay in your browser. Nothing is sent to our servers.</li>
          <li><strong>No tracking.</strong> No analytics, cookies, or tracking pixels.</li>
          <li><strong>Third-party services.</strong> Map tiles load from OpenStreetMap servers. Address search uses the Esri ArcGIS geocoding API. Turn-by-turn routing uses the FOSSGIS Valhalla service — your current location and selected destination are sent only when you explicitly tap "Navigate here". These services may log standard HTTP request data per their own policies.</li>
          <li><strong>Stored items.</strong> The app stores a consent record and an anonymous install ID in localStorage.</li>
          <li><strong>Deletion.</strong> Clear your browser's site data for webmap.dev to remove everything.</li>
        </ul>

        <h3>Terms of Use</h3>
        <ol class="consent-legal">
          <li>This app is for <strong>personal, non-commercial</strong> map viewing and GPS-based navigation.</li>
          <li>The app is provided <strong>as-is with no warranty</strong>. GPS accuracy varies. Do not rely on it for navigation, emergency response, or safety-critical decisions.</li>
          <li><strong>You are responsible</strong> for your own safety. Pay attention to your surroundings and obey local laws.</li>
          <li>To the maximum extent permitted by law, the developer is <strong>not liable</strong> for any damages arising from use of this app.</li>
          <li>These terms may be updated. Material changes will require re-acceptance.</li>
        </ol>
      </div>

      <div id="consent-actions">
        <button id="consent-accept" class="rec-btn rec-btn-start">I agree — continue</button>
        <button id="consent-decline">Decline</button>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    function cleanup(accepted: boolean): void {
      overlay.remove();
      if (accepted) recordConsent();
      resolve(accepted);
    }

    document.getElementById('consent-accept')!.addEventListener('click', () => cleanup(true));
    document.getElementById('consent-decline')!.addEventListener('click', () => cleanup(false));
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

    // Focus the accept button for keyboard accessibility
    document.getElementById('consent-accept')!.focus();
  });
}
