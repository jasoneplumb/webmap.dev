// Modal alert / confirm dialogs for messages a toast can't reliably surface — the
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

interface ConfirmDialogOptions {
  title: string;
  message: string;
  /** Confirm-button label. Defaults to "OK". */
  confirmLabel?: string;
  /** Dismiss-button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Paints the confirm button as destructive and opens with focus on Cancel, so a
   *  stray Enter or Space dismisses rather than destroys. */
  destructive?: boolean;
}

interface DialogButtonSpec {
  label: string;
  className: string;
  /** What the dialog resolves with when this button is pressed. */
  result: boolean;
}

// Cleanup for the dialog currently open, if any. Lets a replacement fully
// tear down the previous dialog — including its document keydown listener.
let activeCleanup: (() => void) | null = null;

/** Build, show, and resolve a modal. Resolves with the pressed button's `result`, or
 *  `false` when the dialog is dismissed by Escape, a backdrop tap, or a replacement
 *  dialog — a caller awaiting a decision must never be left hanging on a dialog that is
 *  no longer on screen. */
function showDialog(
  opts: { title: string; message: string },
  buttons: DialogButtonSpec[],
  focusIndex: number,
): Promise<boolean> {
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

  const buttonEls = buttons.map((spec) => {
    const el = document.createElement('button');
    el.className = spec.className;
    el.textContent = spec.label;
    actions.appendChild(el);
    return el;
  });

  panel.append(heading, body, actions);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  return new Promise<boolean>((resolve) => {
    // A dialog resolves exactly once: the backdrop listener, the keydown listener and a
    // button click can all fire for the same dismissal.
    let settled = false;

    function close(result: boolean): void {
      if (settled) return;
      settled = true;
      if (activeCleanup === dismiss) activeCleanup = null;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
      resolve(result);
    }
    function dismiss(): void {
      close(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        dismiss();
      } else if (e.key === 'Tab') {
        // Focus trap: cycle Tab / Shift+Tab across the dialog's own buttons to honour
        // aria-modal. With a single button this pins focus on it, as it always did.
        // indexOf is -1 when focus sits outside the tracked buttons; the modulo below
        // lands that on the first (or last, shifted) button, which is what we want. It
        // stays correct for any button count as long as step remains +/-1.
        e.preventDefault();
        const current = buttonEls.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.shiftKey ? -1 : 1;
        buttonEls[(current + step + buttonEls.length) % buttonEls.length]?.focus();
      }
    }

    buttonEls.forEach((el, i) => {
      el.addEventListener('click', () => { close(buttons[i]?.result ?? false); });
    });
    // Tap outside the panel dismisses, matching the consent modal.
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) dismiss();
    });
    document.addEventListener('keydown', onKey);
    activeCleanup = dismiss;

    buttonEls[focusIndex]?.focus();
  });
}

/** Show a modal alert dialog. Replaces any dialog already open. */
export function showAlertDialog(opts: AlertDialogOptions): void {
  void showDialog(
    opts,
    [{ label: opts.buttonLabel ?? 'OK', className: 'app-dialog-ok', result: true }],
    0,
  );
}

/** Show a modal confirmation. Resolves true only when the confirm button is pressed;
 *  Escape, a backdrop tap, and a replacement dialog all resolve false.
 *
 *  Cancel sits first so the confirm button lands on the right of the flex-end action row,
 *  where the primary action belongs on web and Android. */
export function showConfirmDialog(opts: ConfirmDialogOptions): Promise<boolean> {
  return showDialog(
    opts,
    [
      { label: opts.cancelLabel ?? 'Cancel', className: 'app-dialog-cancel', result: false },
      {
        label: opts.confirmLabel ?? 'OK',
        className: opts.destructive ? 'app-dialog-ok app-dialog-ok--destructive' : 'app-dialog-ok',
        result: true,
      },
    ],
    // Destructive dialogs open on Cancel; ordinary ones open on the confirm button.
    opts.destructive ? 0 : 1,
  );
}
