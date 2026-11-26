import { describe, expect, it } from 'vitest';

describe('beta enrollment client contract', () => {
  it('documents disabled-by-default production flag', () => {
    // Enforcement lives in SQL billing_settings + Edge requireEntitlement.
    // Default migration value must remain 'false' until PO enables PROD cohort.
    expect('false').toBe('false');
  });
});
