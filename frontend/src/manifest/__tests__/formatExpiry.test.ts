import { describe, it, expect } from 'vitest';
import { formatRelativeExpiry } from '../../utils/formatExpiry';

describe('formatRelativeExpiry', () => {
  it('returns "Expired" for a past date', () => {
    const d = new Date(Date.now() - 1000);
    expect(formatRelativeExpiry(d)).toBe('Expired');
  });

  it('returns "Expired" for now', () => {
    const d = new Date(Date.now());
    expect(formatRelativeExpiry(d)).toBe('Expired');
  });

  it('returns "In N hours" for less than 24 hours', () => {
    const d = new Date(Date.now() + 5 * 60 * 60 * 1000);
    expect(formatRelativeExpiry(d)).toBe('In 5 hours');
  });

  it('returns singular "In 1 hour" for ~1 hour', () => {
    const d = new Date(Date.now() + 1 * 60 * 60 * 1000 + 1000);
    expect(formatRelativeExpiry(d)).toBe('In 1 hour');
  });

  it('returns "In N days" for 24+ hours', () => {
    const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    expect(formatRelativeExpiry(d)).toBe('In 3 days');
  });

  it('returns singular "In 1 day" for ~1 day', () => {
    const d = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000 + 1000);
    expect(formatRelativeExpiry(d)).toBe('In 1 day');
  });

  it('returns "In 365 days" for 1 year', () => {
    const d = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    expect(formatRelativeExpiry(d)).toBe('In 365 days');
  });
});
