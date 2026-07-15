import type { LtUser } from '../../src/runtime/types';

/**
 * Build a test user carrying the typed `LtUser` fields PLUS arbitrary
 * nest-server-only fields (e.g. `leadTableColumns`) — the realistic reason the
 * suites reached for `as never`. Known `LtUser` fields are still type-checked;
 * only the extra fields are `unknown`. Prefer this over a bare cast so the intent
 * ("a real user with extra backend fields") is explicit at the call site.
 */
export function testUser(props: Partial<LtUser> & Record<string, unknown>): LtUser {
  return props as unknown as LtUser;
}

/**
 * Build a DELIBERATELY malformed user for guard / fail-closed tests (e.g. a
 * non-array `roles`, or a missing required field). Names the intent instead of a
 * bare `as never`, so a reviewer sees the payload is invalid ON PURPOSE.
 */
export function malformedUser(props: Record<string, unknown>): LtUser {
  return props as unknown as LtUser;
}
