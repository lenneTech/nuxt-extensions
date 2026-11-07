/**
 * The module's own texts (`src/runtime/locales/de.json` and `en.json`) against the keys the code
 * asks for (DEV-4069).
 *
 * The code translates with `t('lt.<group>.<key>', '<German fallback>')`: without i18n the German
 * fallback is shown, with i18n the locale text. A key missing from the files therefore reaches
 * users of i18n as the raw key (`lt.auth.passkeyAlreadyRegistered` did), and a fallback that
 * differs from `de.json` makes the same message read differently with and without i18n.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import de from '../src/runtime/locales/de.json';
import en from '../src/runtime/locales/en.json';

const RUNTIME = join(__dirname, '../src/runtime');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|vue)$/.test(name) ? [path] : [];
  });
}

/** Every leaf of a locale file as `lt.group.key` → text */
function flatten(node: Record<string, unknown>, prefix = ''): Map<string, string> {
  const leaves = new Map<string, string>();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') {
      for (const [leaf, text] of flatten(value as Record<string, unknown>, path)) leaves.set(leaf, text);
    } else {
      leaves.set(path, String(value));
    }
  }
  return leaves;
}

/** `t('lt.x.y', 'fallback')` calls, the fallback unescaped; one entry per call */
const calls = sourceFiles(RUNTIME).flatMap((file) => {
  const source = readFileSync(file, 'utf8');
  const found: Array<{ fallback: string; file: string; key: string }> = [];
  for (const match of source.matchAll(/\bt\(\s*'(lt\.[\w.]+)'\s*,\s*'((?:[^'\\]|\\.)*)'/g)) {
    found.push({ fallback: match[2]!.replace(/\\(.)/g, '$1'), file, key: match[1]! });
  }
  // Every `'lt.x.y'` literal must belong to such a call, or a differently shaped call escapes this test
  const literals = [...source.matchAll(/'lt\.[a-z]+\.[\w]+'/g)].length;
  if (literals !== found.length) {
    throw new Error(`${file}: ${literals} 'lt.*' literals but ${found.length} t('lt.*', '<fallback>') calls`);
  }
  return found;
});

const deTexts = flatten(de);
const enTexts = flatten(en);

describe('locale keys', () => {
  it('finds the translated messages in the code', () => {
    expect(calls.length).toBeGreaterThan(10);
  });

  it('has every key the code uses in both locale files', () => {
    const used = [...new Set(calls.map((call) => call.key))].sort();
    expect(used.filter((key) => !deTexts.has(key))).toEqual([]);
    expect(used.filter((key) => !enTexts.has(key))).toEqual([]);
  });

  it('ships no key the code does not use', () => {
    const used = new Set(calls.map((call) => call.key));
    expect([...deTexts.keys()].filter((key) => !used.has(key))).toEqual([]);
  });

  it('keeps de.json and en.json in step', () => {
    expect([...enTexts.keys()].sort()).toEqual([...deTexts.keys()].sort());
  });

  it('uses the de.json text as the German fallback, so a message reads the same with and without i18n', () => {
    const differing = calls.filter((call) => deTexts.get(call.key) !== call.fallback).map((call) => `${call.key}: "${call.fallback}" ≠ "${deTexts.get(call.key)}"`);
    expect(differing).toEqual([]);
  });
});
