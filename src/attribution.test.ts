// The attribution line is a licence obligation, and its links open third-party pages from a map
// that may be mid-route. Both properties are easy to lose in a later edit, so they are pinned:
// the credit still reads as the provider's name, and the link cannot reach back into this app.
import { describe, it, expect } from 'vitest';
import { sourceCredit } from './attribution';

describe('sourceCredit', () => {
  const credit = sourceCredit('CyclOSM', 'https://www.cyclosm.org/legend.html', 'CyclOSM legend');

  it('renders the provider name as the link text', () => {
    // The credit must keep reading as the provider's name — adding "(key)" or "more info" to six
    // credits is what costs the map another wrapped line on a phone.
    expect(credit).toContain('>CyclOSM</a>');
    expect(credit).toContain('href="https://www.cyclosm.org/legend.html"');
  });

  it('opens in a new tab with the opener severed', () => {
    // Without target=_blank the tap tears down the map and its GPS watch; without noopener the
    // opened page can reach back through window.opener.
    expect(credit).toContain('target="_blank"');
    expect(credit).toContain('rel="noopener noreferrer"');
  });

  it('carries a title saying what is on the other end', () => {
    expect(credit).toContain('title="CyclOSM legend"');
  });
});
