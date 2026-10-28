import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  allowedRequestOrigin,
  buildSecurityTxt,
  normalizeSecurityTxtContacts,
  normalizeSecurityTxtList,
  normalizeSecurityTxtValidDays,
  resolveSecurityTxt,
  SECURITY_TXT_DEFAULT_VALID_DAYS,
  toSecurityTxtOrigin,
} from '../src/runtime/server/lib/security-txt';

/**
 * `/.well-known/security.txt` must stay valid according to RFC 9116.
 *
 * Scanners such as the BSI's treat a file without `Contact`, with more than one `Expires` or with
 * an `Expires` in the past as untrustworthy and drop it silently. `Expires` is therefore derived
 * from the request time instead of being written down once, and these tests pin that it stays
 * inside the window the RFC recommends. Ported from the lenne.tech website (DEV-3602), where the
 * same builder has been live since 2026-10-13.
 */

const NOW = new Date('2026-10-13T08:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const OPTIONS = { contacts: ['mailto:security@lenne.tech'], now: NOW, origins: ['https://lenne.tech'], preferredLanguages: ['de', 'en'] };

function fields(txt: string, name: string): string[] {
  return txt
    .split('\n')
    .filter((line) => line.startsWith(`${name}: `))
    .map((line) => line.slice(name.length + 2));
}

describe('buildSecurityTxt', () => {
  const txt = buildSecurityTxt(OPTIONS);

  it('names the contact', () => {
    expect(fields(txt, 'Contact')).toEqual(['mailto:security@lenne.tech']);
  });

  it('writes one Contact line per contact, in the given order', () => {
    const both = buildSecurityTxt({ ...OPTIONS, contacts: ['mailto:security@example.com', 'https://example.com/report'] });
    expect(fields(both, 'Contact')).toEqual(['mailto:security@example.com', 'https://example.com/report']);
  });

  it('carries exactly one Expires, in the future and less than a year away', () => {
    const expires = fields(txt, 'Expires');
    expect(expires).toHaveLength(1);
    expect(expires[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const distance = new Date(expires[0]!).getTime() - NOW.getTime();
    expect(distance).toBeGreaterThan((SECURITY_TXT_DEFAULT_VALID_DAYS - 1) * DAY_MS);
    expect(distance).toBeLessThanOrEqual(SECURITY_TXT_DEFAULT_VALID_DAYS * DAY_MS);
    expect(distance).toBeLessThan(365 * DAY_MS);
  });

  it('cuts Expires to midnight UTC, so it stays the same for a whole day', () => {
    expect(fields(txt, 'Expires')).toEqual(['2027-04-11T00:00:00.000Z']);
    for (const time of ['2026-10-13T00:00:00.000Z', '2026-10-13T23:59:59.999Z']) {
      expect(fields(buildSecurityTxt({ ...OPTIONS, now: new Date(time) }), 'Expires')).toEqual(['2027-04-11T00:00:00.000Z']);
    }
  });

  it('moves Expires along with the request time', () => {
    const later = buildSecurityTxt({ ...OPTIONS, now: new Date(NOW.getTime() + 400 * DAY_MS) });
    expect(fields(later, 'Expires')).toEqual(['2028-05-15T00:00:00.000Z']);
  });

  it('never puts Expires a year or more away, whatever validDays says', () => {
    const distance = new Date(fields(buildSecurityTxt({ ...OPTIONS, validDays: 5000 }), 'Expires')[0]!).getTime() - NOW.getTime();
    expect(distance).toBeLessThan(365 * DAY_MS);
  });

  it('leaves Encryption and Policy out unless configured', () => {
    expect(fields(txt, 'Encryption')).toEqual([]);
    expect(fields(txt, 'Policy')).toEqual([]);
  });

  it('resolves Encryption and Policy paths against the first origin, and keeps absolute URIs', () => {
    const withBoth = buildSecurityTxt({ ...OPTIONS, encryption: '/.well-known/pgp-key.txt', origins: ['https://lenne.tech', 'https://www.lenne.tech'], policy: 'https://example.com/policy' });
    expect(fields(withBoth, 'Encryption')).toEqual(['https://lenne.tech/.well-known/pgp-key.txt']);
    expect(fields(withBoth, 'Policy')).toEqual(['https://example.com/policy']);
  });

  it('drops a path-only Encryption when there is no origin to resolve it against', () => {
    expect(fields(buildSecurityTxt({ ...OPTIONS, encryption: '/.well-known/pgp-key.txt', origins: [] }), 'Encryption')).toEqual([]);
  });

  it('lists the preferred languages', () => {
    expect(fields(txt, 'Preferred-Languages')).toEqual(['de, en']);
  });

  it('writes one Canonical per distinct origin', () => {
    const both = buildSecurityTxt({ ...OPTIONS, origins: ['https://lenne.tech/', 'https://www.lenne.tech', 'https://lenne.tech'] });
    expect(fields(both, 'Canonical')).toEqual(['https://lenne.tech/.well-known/security.txt', 'https://www.lenne.tech/.well-known/security.txt']);
  });

  it('ends with a newline and contains nothing but fields', () => {
    expect(txt.endsWith('\n')).toBe(true);
    for (const line of txt.trimEnd().split('\n')) {
      expect(line).toMatch(/^[A-Za-z-]+: \S+(, \S+)*$/);
    }
  });

  it('cannot be made to forge a field through a configured value', () => {
    const forged = buildSecurityTxt({
      ...OPTIONS,
      contacts: ['mailto:a@example.com\nContact: mailto:evil@example.com'],
      policy: 'https://example.com\nExpires: 1999-01-01T00:00:00.000Z',
      preferredLanguages: ['de\nCanonical: https://evil.example'],
    });
    expect(forged).not.toContain('evil');
    expect(fields(forged, 'Expires')).toHaveLength(1);
  });
});

describe('normalisation', () => {
  it('accepts a single contact as well as a list, and drops blanks', () => {
    expect(normalizeSecurityTxtContacts('mailto:security@lenne.tech')).toEqual(['mailto:security@lenne.tech']);
    expect(normalizeSecurityTxtContacts([' mailto:a@example.com ', '', 'https://example.com/report'])).toEqual(['mailto:a@example.com', 'https://example.com/report']);
    expect(normalizeSecurityTxtContacts('')).toEqual([]);
    expect(normalizeSecurityTxtContacts(undefined)).toEqual([]);
  });

  it('reads a list from an environment string', () => {
    expect(normalizeSecurityTxtList('de, en')).toEqual(['de', 'en']);
    expect(normalizeSecurityTxtList(['example.com', 'www.example.com'])).toEqual(['example.com', 'www.example.com']);
    expect(normalizeSecurityTxtList(undefined)).toEqual([]);
  });

  it('clamps validDays and falls back to the default for nonsense', () => {
    expect(normalizeSecurityTxtValidDays(90)).toBe(90);
    expect(normalizeSecurityTxtValidDays('90')).toBe(90);
    expect(normalizeSecurityTxtValidDays(5000)).toBe(365);
    for (const value of [0, -3, Number.NaN, Infinity, 'abc', undefined]) {
      expect(normalizeSecurityTxtValidDays(value)).toBe(SECURITY_TXT_DEFAULT_VALID_DAYS);
    }
  });

  it('turns a site URL into its origin', () => {
    expect(toSecurityTxtOrigin('https://example.com/some/path/')).toBe('https://example.com');
    expect(toSecurityTxtOrigin('http://localhost:3001')).toBe('http://localhost:3001');
    for (const url of [undefined, '', 'example.com', 'ftp://example.com']) {
      expect(toSecurityTxtOrigin(url)).toBeUndefined();
    }
  });

  it('accepts the requested host only from the allowlist', () => {
    const hosts = ['lenne.tech', 'www.lenne.tech'];
    expect(allowedRequestOrigin('www.lenne.tech', hosts)).toBe('https://www.lenne.tech');
    expect(allowedRequestOrigin('WWW.Lenne.Tech', hosts)).toBe('https://www.lenne.tech');
    for (const host of [undefined, '', 'evil.example', 'lenne.tech.evil.example', 'lenne.tech:8443', 'lenne.tech/x\nContact: mailto:evil@example.com']) {
      expect(allowedRequestOrigin(host, hosts)).toBeUndefined();
    }
    expect(allowedRequestOrigin('lenne.tech', [])).toBeUndefined();
  });
});

describe('resolveSecurityTxt', () => {
  const defaults = { contact: 'mailto:security@lenne.tech', encryption: '', hosts: [], policy: '', preferredLanguages: ['de', 'en'], validDays: 180 };

  it('builds the file from the module defaults and the site URL', () => {
    const txt = resolveSecurityTxt({ config: defaults, now: NOW, requestHost: 'example.com', siteUrl: 'https://example.com' })!;
    expect(fields(txt, 'Contact')).toEqual(['mailto:security@lenne.tech']);
    expect(fields(txt, 'Canonical')).toEqual(['https://example.com/.well-known/security.txt']);
    expect(fields(txt, 'Preferred-Languages')).toEqual(['de, en']);
  });

  it('adds the requested host as a second Canonical only when it is listed', () => {
    const config = { ...defaults, hosts: ['example.com', 'www.example.com'] };
    expect(fields(resolveSecurityTxt({ config, now: NOW, requestHost: 'www.example.com', siteUrl: 'https://example.com' })!, 'Canonical')).toEqual([
      'https://example.com/.well-known/security.txt',
      'https://www.example.com/.well-known/security.txt',
    ]);
    expect(fields(resolveSecurityTxt({ config, now: NOW, requestHost: 'attacker.example', siteUrl: 'https://example.com' })!, 'Canonical')).toEqual([
      'https://example.com/.well-known/security.txt',
    ]);
  });

  it('never derives Canonical from an unlisted request host when no site URL is set', () => {
    expect(fields(resolveSecurityTxt({ config: defaults, now: NOW, requestHost: 'attacker.example', siteUrl: undefined })!, 'Canonical')).toEqual([]);
  });

  it('takes runtime overrides that arrive as strings', () => {
    const txt = resolveSecurityTxt({ config: { ...defaults, contact: 'mailto:security@customer.example', preferredLanguages: 'en', validDays: '30' }, now: NOW, requestHost: undefined, siteUrl: undefined })!;
    expect(fields(txt, 'Contact')).toEqual(['mailto:security@customer.example']);
    expect(fields(txt, 'Preferred-Languages')).toEqual(['en']);
    expect(fields(txt, 'Expires')).toEqual(['2026-11-12T00:00:00.000Z']);
  });

  it('yields nothing when the contact was blanked, so the route answers 404', () => {
    expect(resolveSecurityTxt({ config: { ...defaults, contact: '' }, now: NOW, requestHost: undefined, siteUrl: 'https://example.com' })).toBeUndefined();
    expect(resolveSecurityTxt({ config: undefined, now: NOW, requestHost: undefined, siteUrl: 'https://example.com' })).toBeUndefined();
  });
});

/**
 * The module setup is not executable in a unit test, so these pin its source, the same way
 * `tus-module-options.test.ts` does. Each one guards a property nothing else would catch.
 */
describe('securityTxt module wiring', () => {
  const moduleSource = readFileSync(resolve(process.cwd(), 'src/module.ts'), 'utf8');

  it('is off by default and defaults the contact to security@lenne.tech', () => {
    expect(moduleSource).toMatch(/securityTxt: \{[^}]*contact: SECURITY_TXT_DEFAULT_CONTACT,[^}]*enabled: false,[^}]*\}/);
    expect(readFileSync(resolve(process.cwd(), 'src/runtime/server/lib/security-txt.ts'), 'utf8')).toContain("SECURITY_TXT_DEFAULT_CONTACT = 'mailto:security@lenne.tech'");
  });

  it('registers the route only when enabled, and without a method so HEAD is answered too', () => {
    expect(moduleSource).toMatch(/if \(resolvedOptions\.securityTxt\.enabled === true\) \{[\s\S]*addServerHandler\(\{ handler: [^}]*route: SECURITY_TXT_PATH \}\)/);
    expect(moduleSource).not.toMatch(/addServerHandler\(\{[^}]*method:/);
  });

  it('keeps the route out of prerendering, so Expires is not frozen at build time', () => {
    expect(moduleSource).toMatch(/\[SECURITY_TXT_PATH\]: \{[^}]*prerender: false/);
    expect(moduleSource).toMatch(/prerender\.ignore = \[.*, SECURITY_TXT_PATH\];/);
  });

  it('writes the values into the server-only runtime config, never the public one', () => {
    expect(moduleSource).toMatch(/\(nuxt\.options\.runtimeConfig as any\)\.ltExtensions = \{[\s\S]*securityTxt: \{/);
    const publicBlock = moduleSource.match(/runtimeConfig\.public\.ltExtensions = \{[\s\S]*?\n {4}\};/)?.[0];
    expect(publicBlock).toBeDefined();
    expect(publicBlock).not.toContain('securityTxt');
  });
});
