// Modal alert dialog for messages a toast can't reliably surface — the
// geocode-bar tray (z-index 1500) covers the toast (z-index 1000); this
// sits at z-index 3000, above all app chrome.

const TITLE_ID = 'app-dialog-title';
const MESSAGE_ID = 'app-dialog-message';

interface AlertDialogOptions {
  title: string;
  message: string;
  /** Acknowledge-button label. Defaults to "OK". */
  buttonLabel?: string;
}

// Cleanup for the dialog currently open, if any. Lets a replacement fully
// tear down the previous dialog — including its document keydown listener.
let activeCleanup: (() => void) | null = null;

/** Show a modal alert dialog. Replaces any dialog already open. */
export function showAlertDialog(opts: AlertDialogOptions): void {
  // Never stack dialogs — a newer message supersedes an unacknowledged one.
  activeCleanup?.();

  const previouslyFocused = document.activeElement as HTMLElement | null;

  const overlay = document.createElement('div');
  overlay.id = 'app-dialog-overlay';
  overlay.className = 'app-dialog-overlay';

  const panel = document.createElement('div');
  panel.className = 'app-dialog-panel';
  panel.setAttribute('role', 'alertdialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', TITLE_ID);
  panel.setAttribute('aria-describedby', MESSAGE_ID);

  const heading = document.createElement('h2');
  heading.id = TITLE_ID;
  heading.className = 'app-dialog-title';
  heading.textContent = opts.title;

  const body = document.createElement('p');
  body.id = MESSAGE_ID;
  body.className = 'app-dialog-message';
  body.textContent = opts.message;

  const actions = document.createElement('div');
  actions.className = 'app-dialog-actions';

  const okBtn = document.createElement('button');
  okBtn.className = 'app-dialog-ok';
  okBtn.textContent = opts.buttonLabel ?? 'OK';

  actions.appendChild(okBtn);
  panel.append(heading, body, actions);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  function cleanup(): void {
    if (activeCleanup === cleanup) activeCleanup = null;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    previouslyFocused?.focus();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      cleanup();
    } else if (e.key === 'Tab') {
      // Focus trap: keep Tab and Shift+Tab on the OK button (the only
      // focusable element) to honour aria-modal.
      e.preventDefault();
      okBtn.focus();
    }
  }

  okBtn.addEventListener('click', cleanup);
  // Tap outside the panel dismisses, matching the consent modal.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cleanup();
  });
  document.addEventListener('keydown', onKey);
  activeCleanup = cleanup;

  okBtn.focus();
}
