import { describe, expect, it } from 'vitest';

import { createInitialSetupCode } from './initialSetupCode.ts';

const setupCode = 'setup-code-'.padEnd(43, 'x');

describe('createInitialSetupCode', () => {
  it('generates a high-entropy URL-safe code and verifies only that code', () => {
    const first = createInitialSetupCode();
    const second = createInitialSetupCode();

    expect(first.code).toMatch(/^[\w-]{43}$/u);
    expect(second.code).toMatch(/^[\w-]{43}$/u);
    expect(second.code).not.toBe(first.code);
    expect(first.matches(first.code)).toBe(true);
    expect(first.matches(second.code)).toBe(false);
    expect(first.matches(undefined)).toBe(false);
  });

  it('supports deterministic verification without using plaintext string comparison', () => {
    const code = createInitialSetupCode({ generateSecret: () => setupCode });

    expect(code.code).toBe(setupCode);
    expect(code.matches(setupCode)).toBe(true);
    expect(code.matches(`${setupCode.slice(0, -1)}y`)).toBe(false);
    expect(code.matches('')).toBe(false);
  });

  it('rejects a weak or malformed generated code', () => {
    expect(() => createInitialSetupCode({ generateSecret: () => 'too-short' })).toThrow(
      'Initial setup code generator must return a 32-byte base64url secret',
    );
    expect(() => createInitialSetupCode({ generateSecret: () => 'x'.repeat(42) + '+' })).toThrow(
      'Initial setup code generator must return a 32-byte base64url secret',
    );
  });
});
