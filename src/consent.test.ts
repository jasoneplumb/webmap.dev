/**
 * The consent promise is the app's boot gate — main.ts awaits it before
 * bootApp(). Anything that stops it resolving leaves a blank page with no error
 * path, so these tests pin the failure modes that used to do exactly that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasCompassOptIn, hasConsent, showConsentModal } from './consent';

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
    await expect(pending).resolves.toMatchObject({ accepted: true });
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
    await expect(pending).resolves.toMatchObject({ accepted: true });
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
    await expect(pending).resolves.toMatchObject({ accepted: true });
  });

  it('offers the compass row already checked', async () => {
    // Preselecting it is the entire mechanism behind "compass on by default": iOS will not
    // grant orientation outside a user gesture, so the accept tap has to carry the grant.
    const pending = showConsentModal();
    const box = document.querySelector<HTMLInputElement>('#consent-compass-check');
    expect(box).not.toBeNull();
    expect(box!.checked).toBe(true);
    // Close it before finishing: clearing document.body between tests does not detach the
    // modal's document-level keydown listener, so an abandoned modal would go on handling
    // Escape and break a later test that asserts the listener is gone.
    document.querySelector<HTMLButtonElement>('#consent-decline')!.click();
    await pending;
  });

  it('records the opt-in and hands back a pending grant when accepted as-is', async () => {
    const pending = showConsentModal();
    accept();
    const result = await pending;
    expect(result.accepted).toBe(true);
    expect(result.compassRequest).toBeInstanceOf(Promise);
    // Requested from inside the click handler, so the gesture iOS requires is the accept tap.
    await expect(result.compassRequest).resolves.toBe('granted');
    expect(hasCompassOptIn()).toBe(true);
  });

  it('records no opt-in and requests nothing when the box is unchecked', async () => {
    const pending = showConsentModal();
    document.querySelector<HTMLInputElement>('#consent-compass-check')!.checked = false;
    accept();
    await expect(pending).resolves.toMatchObject({ accepted: true, compassRequest: null });
    // Must be a stored false, not an absent key: the gesture-less re-request on later loads
    // reads this, and it should never claim an opt-in the user declined.
    expect(hasCompassOptIn()).toBe(false);
    expect(localStorage.getItem('webmap-compass-opt-in')).toBe('false');
  });

  it('resolves accepted:false on decline without touching the preference', async () => {
    const pending = showConsentModal();
    document.querySelector<HTMLButtonElement>('#consent-decline')!.click();
    await expect(pending).resolves.toMatchObject({ accepted: false, compassRequest: null });
    expect(localStorage.getItem('webmap-compass-opt-in')).toBeNull();
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
