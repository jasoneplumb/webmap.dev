/**
 * The consent promise is the app's boot gate — main.ts awaits it before
 * bootApp(). Anything that stops it resolving leaves a blank page with no error
 * path, so these tests pin the failure modes that used to do exactly that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasConsent, showConsentModal } from './consent';

const realRandomUUID = crypto.randomUUID;

/** Accept the modal: scroll the terms to the bottom, then click through. */
function accept(): void {
  const body = document.querySelector<HTMLElement>('#consent-body')!;
  // jsdom reports every dimension as 0, so the modal's atBottom() check already
  // passes and the button is enabled — no scrolling needed.
  const btn = document.querySelector<HTMLButtonElement>('#consent-accept')!;
  expect(btn.disabled).toBe(false);
  void body;
  btn.click();
}

describe('showConsentModal', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    Object.defineProperty(crypto, 'randomUUID', { value: realRandomUUID, configurable: true });
    vi.restoreAllMocks();
  });

  it('resolves and records consent on accept', async () => {
    const pending = showConsentModal();
    accept();
    await expect(pending).resolves.toBe(true);
    expect(hasConsent()).toBe(true);
    expect(document.querySelector('#consent-overlay')).toBeNull();
  });

  it('resolves without crypto.randomUUID (insecure context)', async () => {
    // Serving over plain HTTP to a LAN IP — a phone testing the dev server —
    // leaves crypto.randomUUID undefined. It used to throw inside the click
    // handler, so the promise never settled and the app never booted.
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });

    const pending = showConsentModal();
    accept();
    await expect(pending).resolves.toBe(true);
    expect(hasConsent()).toBe(true);
    expect(localStorage.getItem('webmap-consent-install-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('still resolves when storage rejects the write', async () => {
    // iOS Safari private browsing throws QuotaExceededError on setItem. Booting
    // matters more than remembering: re-prompting next load beats a blank page.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const pending = showConsentModal();
    accept();
    await expect(pending).resolves.toBe(true);
  });

  it('unbinds the keydown listener once closed', async () => {
    const pending = showConsentModal();
    accept();
    await pending;

    // A leaked listener would keep firing cleanup() against a detached modal.
    const removed = vi.spyOn(document, 'removeEventListener');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(removed).not.toHaveBeenCalled();
  });
});
