/**
 * Intent: First-run consent modal for GPS tracking — stores acceptance in localStorage
 * Context: Called by recording.ts before startRecording(); re-prompts only when CONSENT_VERSION changes
 * Pattern: Returns a Promise that resolves true (accepted) or false (declined); no AppState dependency
 */

const CONSENT_VERSION = '1.0';
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
    panel.setAttribute('aria-label', 'Before you start recording');
    panel.innerHTML = `
      <h2>Before you start recording</h2>
      <p>webmap.dev records your GPS location to draw a trail on the map. Here's what you should know:</p>
      <ul>
        <li><strong>Your data stays on this device.</strong> GPS coordinates, speed, and altitude are stored in your browser only. Nothing is sent to a server.</li>
        <li><strong>You control your data.</strong> You can export your trail as a GPX file or delete it at any time. Clearing your browser's site data removes everything.</li>
        <li><strong>Stay aware of your surroundings.</strong> Do not rely on this app for navigation or safety. Keep your eyes on the trail, not the screen.</li>
      </ul>
      <details>
        <summary>Terms of Use</summary>
        <div class="consent-legal">
          <p><strong>Terms of Use</strong> — v1.0</p>
          <ol>
            <li><strong>Permitted use.</strong> The app is for personal, non-commercial GPS trail recording and map viewing.</li>
            <li><strong>No warranty.</strong> The app may contain errors. GPS accuracy varies by device and environment. Do not rely on it for navigation, emergency response, or safety-critical decisions.</li>
            <li><strong>Your responsibility.</strong> You are responsible for your own safety while using the app. Pay attention to your surroundings. Obey all local laws and trail regulations.</li>
            <li><strong>Data.</strong> All GPS and trail data is stored locally on your device. The app does not collect, transmit, or store personal data on any server. See the Privacy Policy for details.</li>
            <li><strong>Limitation of liability.</strong> To the maximum extent permitted by law, the developer is not liable for any damages arising from your use of the app.</li>
            <li><strong>Changes.</strong> These terms may be updated. Material changes will require you to re-accept before recording.</li>
          </ol>
        </div>
      </details>
      <details>
        <summary>Privacy Policy</summary>
        <div class="consent-legal">
          <p><strong>Privacy Policy</strong> — v1.0</p>
          <p><strong>What we collect</strong><br>
          When you accept this prompt, the app stores three items in your browser's local storage: a consent version identifier, a timestamp, and a randomly generated anonymous install ID. That's it.</p>
          <p><strong>GPS data</strong><br>
          While recording, GPS coordinates, speed, and altitude are held in memory and backed up to your browser's local storage for crash recovery. This data never leaves your device.</p>
          <p><strong>What we don't do</strong></p>
          <ul>
            <li>No server-side data collection</li>
            <li>No analytics, cookies, or tracking pixels</li>
            <li>No third-party data sharing</li>
          </ul>
          <p><strong>Third-party services</strong><br>
          Map tiles are loaded from OpenStreetMap tile servers. Address search uses the Esri ArcGIS geocoding API. These services may log standard HTTP request data (IP address, request URL) per their own privacy policies.</p>
          <p><strong>Data deletion</strong><br>
          Clear your browser's site data for webmap.dev to remove all stored information, including consent records and trail backups.</p>
        </div>
      </details>
      <div id="consent-actions">
        <button id="consent-accept" class="rec-btn rec-btn-start">I agree — start tracking</button>
        <button id="consent-decline">Cancel</button>
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
