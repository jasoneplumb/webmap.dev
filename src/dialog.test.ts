import { describe, it, expect, afterEach } from 'vitest';
import { showAlertDialog } from './dialog';

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
