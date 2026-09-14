import { describe, it, expect, afterEach } from 'vitest';
import { showAlertDialog, showConfirmDialog } from './dialog';

describe('showAlertDialog', () => {
  afterEach(() => {
    document.getElementById('app-dialog-overlay')?.remove();
  });

  it('renders an overlay with the given title and message', () => {
    showAlertDialog({ title: 'Routing unavailable', message: 'Service is down' });
    const overlay = document.getElementById('app-dialog-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelector('.app-dialog-title')?.textContent).toBe('Routing unavailable');
    expect(overlay?.querySelector('.app-dialog-message')?.textContent).toBe('Service is down');
    expect(overlay?.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it('dismisses on the OK button', () => {
    showAlertDialog({ title: 'T', message: 'M' });
    (document.querySelector('.app-dialog-ok') as HTMLButtonElement).click();
    expect(document.getElementById('app-dialog-overlay')).toBeNull();
  });

  it('dismisses on Escape', () => {
    showAlertDialog({ title: 'T', message: 'M' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('app-dialog-overlay')).toBeNull();
  });

  it('dismisses on backdrop click', () => {
    showAlertDialog({ title: 'T', message: 'M' });
    const overlay = document.getElementById('app-dialog-overlay')!;
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('app-dialog-overlay')).toBeNull();
  });

  it('does not leave a stale Escape listener after replacement', () => {
    showAlertDialog({ title: 'First', message: 'one' });
    showAlertDialog({ title: 'Second', message: 'two' });
    // One Escape closes the live dialog; no orphaned listener from the first.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('app-dialog-overlay')).toBeNull();
  });

  it('replaces an existing dialog instead of stacking', () => {
    showAlertDialog({ title: 'First', message: 'one' });
    showAlertDialog({ title: 'Second', message: 'two' });
    expect(document.querySelectorAll('.app-dialog-overlay')).toHaveLength(1);
    expect(document.querySelector('.app-dialog-title')?.textContent).toBe('Second');
  });

  it('uses a custom button label when given', () => {
    showAlertDialog({ title: 'T', message: 'M', buttonLabel: 'Got it' });
    expect(document.querySelector('.app-dialog-ok')?.textContent).toBe('Got it');
  });

  it('wires aria-labelledby and aria-describedby to the title and message', () => {
    showAlertDialog({ title: 'Heads up', message: 'Details here' });
    const panel = document.querySelector('[role="alertdialog"]')!;
    const titleId = panel.getAttribute('aria-labelledby')!;
    const msgId = panel.getAttribute('aria-describedby')!;
    expect(document.getElementById(titleId)?.textContent).toBe('Heads up');
    expect(document.getElementById(msgId)?.textContent).toBe('Details here');
    expect(panel.hasAttribute('aria-label')).toBe(false);
  });

  it('traps Tab focus on the OK button', () => {
    showAlertDialog({ title: 'T', message: 'M' });
    const okBtn = document.querySelector('.app-dialog-ok') as HTMLButtonElement;
    okBtn.blur();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(document.activeElement).toBe(okBtn);
  });
});

describe('showConfirmDialog', () => {
  afterEach(() => {
    document.getElementById('app-dialog-overlay')?.remove();
  });

  const cancelBtn = (): HTMLButtonElement =>
    document.querySelector('.app-dialog-cancel') as HTMLButtonElement;
  const confirmBtn = (): HTMLButtonElement =>
    document.querySelector('.app-dialog-ok') as HTMLButtonElement;

  it('resolves true when the confirm button is pressed', async () => {
    const decision = showConfirmDialog({ title: 'Delete Region 1?', message: 'Frees 12 MB' });
    confirmBtn().click();
    await expect(decision).resolves.toBe(true);
    expect(document.getElementById('app-dialog-overlay')).toBeNull();
  });

  it('resolves false on Cancel', async () => {
    const decision = showConfirmDialog({ title: 'T', message: 'M' });
    cancelBtn().click();
    await expect(decision).resolves.toBe(false);
    expect(document.getElementById('app-dialog-overlay')).toBeNull();
  });

  it('resolves false on Escape', async () => {
    const decision = showConfirmDialog({ title: 'T', message: 'M' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(decision).resolves.toBe(false);
  });

  it('resolves false on a backdrop tap', async () => {
    const decision = showConfirmDialog({ title: 'T', message: 'M' });
    document.getElementById('app-dialog-overlay')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect(decision).resolves.toBe(false);
  });

  it('resolves a pending confirmation when another dialog replaces it', async () => {
    // Otherwise the caller awaits forever on a dialog that is no longer on screen — for
    // the region manager, a Delete button left disabled for the life of the panel.
    const decision = showConfirmDialog({ title: 'T', message: 'M' });
    showAlertDialog({ title: 'Something else', message: 'M' });
    await expect(decision).resolves.toBe(false);
  });

  it('opens a destructive confirm on Cancel so a stray Enter cannot destroy', () => {
    void showConfirmDialog({ title: 'T', message: 'M', destructive: true, confirmLabel: 'Delete' });
    expect(document.activeElement).toBe(cancelBtn());
    expect(confirmBtn().classList.contains('app-dialog-ok--destructive')).toBe(true);
  });

  it('opens an ordinary confirm on the confirm button', () => {
    void showConfirmDialog({ title: 'T', message: 'M' });
    expect(document.activeElement).toBe(confirmBtn());
    expect(confirmBtn().classList.contains('app-dialog-ok--destructive')).toBe(false);
  });

  it('cycles Tab and Shift+Tab between the two buttons', () => {
    void showConfirmDialog({ title: 'T', message: 'M', destructive: true });
    expect(document.activeElement).toBe(cancelBtn());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(document.activeElement).toBe(confirmBtn());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(document.activeElement).toBe(cancelBtn());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
    expect(document.activeElement).toBe(confirmBtn());
  });

  it('puts Cancel before the confirm button, and defaults the labels', () => {
    void showConfirmDialog({ title: 'T', message: 'M' });
    const labels = Array.from(document.querySelectorAll('.app-dialog-actions button'))
      .map((b) => b.textContent);
    expect(labels).toEqual(['Cancel', 'OK']);
  });

  it('uses custom labels when given', () => {
    void showConfirmDialog({ title: 'T', message: 'M', confirmLabel: 'Delete', cancelLabel: 'Keep' });
    expect(confirmBtn().textContent).toBe('Delete');
    expect(cancelBtn().textContent).toBe('Keep');
  });
});
