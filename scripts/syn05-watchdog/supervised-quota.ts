/**
 * C3-B.5 — Durable oneshot quota for supervised Issue create.
 * Durability is Issue-marker based (not process memory).
 * MAX_CREATED_ISSUES=1, MAX_CREATE_POST_ATTEMPTS=1.
 */

export const C3_B5_TEST_TITLE = '[BOTH SYN-05 TEST] C3-B.5 Supervised Delivery' as const;
export const C3_B5_TEST_MARKER = 'both-syn05-c3-b5-supervised-test:v1' as const;
export const C3_B5_FINGERPRINT_PREFIX = 'C3-B.5|TEST|' as const;
export const MAX_CREATED_ISSUES = 1 as const;
export const MAX_CREATE_POST_ATTEMPTS = 1 as const;

export type QuotaIssueProbe = {
  number: number;
  title: string;
  body?: string | null;
  state: string;
};

export type QuotaSnapshot = {
  existing_test_issues: QuotaIssueProbe[];
  create_posts_attempted: number;
  remaining_creates: number;
  remaining_post_attempts: number;
  blocked: boolean;
  code: string;
};

export type QuotaLedger = {
  create_posts_attempted: number;
};

export function isC3B5TestIssue(issue: QuotaIssueProbe): boolean {
  if (issue.title.includes(C3_B5_TEST_TITLE) || issue.title.includes('C3-B.5 Supervised Delivery')) {
    return true;
  }
  const body = issue.body ?? '';
  return body.includes(C3_B5_TEST_MARKER) || body.includes(C3_B5_FINGERPRINT_PREFIX);
}

export function evaluateQuota(
  existing: QuotaIssueProbe[],
  ledger: QuotaLedger = { create_posts_attempted: 0 },
): QuotaSnapshot {
  const existing_test_issues = existing.filter(isC3B5TestIssue);
  const remaining_creates = Math.max(0, MAX_CREATED_ISSUES - existing_test_issues.length);
  const remaining_post_attempts = Math.max(0, MAX_CREATE_POST_ATTEMPTS - ledger.create_posts_attempted);

  if (existing_test_issues.length > 0) {
    return {
      existing_test_issues,
      create_posts_attempted: ledger.create_posts_attempted,
      remaining_creates: 0,
      remaining_post_attempts: 0,
      blocked: true,
      code: 'quota_issue_already_exists',
    };
  }
  if (ledger.create_posts_attempted >= MAX_CREATE_POST_ATTEMPTS) {
    return {
      existing_test_issues,
      create_posts_attempted: ledger.create_posts_attempted,
      remaining_creates,
      remaining_post_attempts: 0,
      blocked: true,
      code: 'quota_post_attempts_exhausted',
    };
  }
  if (remaining_creates <= 0) {
    return {
      existing_test_issues,
      create_posts_attempted: ledger.create_posts_attempted,
      remaining_creates: 0,
      remaining_post_attempts,
      blocked: true,
      code: 'quota_exhausted',
    };
  }
  return {
    existing_test_issues,
    create_posts_attempted: ledger.create_posts_attempted,
    remaining_creates,
    remaining_post_attempts,
    blocked: false,
    code: 'quota_ok',
  };
}

/** Call before POST create — returns updated ledger with attempt counted. */
export function consumePostAttempt(ledger: QuotaLedger): QuotaLedger {
  return { create_posts_attempted: ledger.create_posts_attempted + 1 };
}
