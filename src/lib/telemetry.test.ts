import { describe, expect, it, vi } from 'vitest';

vi.mock('./errorLog', () => ({ noteError: vi.fn() }));
vi.mock('./update', () => ({ isStaleCode: () => false, updatingMessage: () => '' }));

import { errorMessage } from './telemetry';

describe('what a person is told', () => {
  const quota = (m: string) => new DOMException(m, 'QuotaExceededError');
  it('a codec taken back is not a full disk (audit V-170)', () => {
    expect(errorMessage(quota('Codec reclaimed due to inactivity.'))).toContain('decoder');
  });
  it('a full disk is a full disk', () => {
    expect(errorMessage(quota('The quota has been exceeded.'))).toContain('storage');
  });
});
