import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guard against the historical drift bug where new public types were added to
// `src/runtime/types/*.ts` but forgotten in the barrel `src/runtime/types/index.ts`
// or in the module entry (`src/module.ts`). The bug surfaced in v1.7.0 when six
// new AI types (LtAiPrompt, LtAiEffectiveSlot, LtAiPlaceholder, LtAiPromptRunInput,
// UseLtAiPromptsReturn, UseLtAiPlaceholdersReturn) were defined but unreachable
// via `import type { ... } from '@lenne.tech/nuxt-extensions'`.

const RUNTIME_TYPES = resolve(process.cwd(), 'src/runtime/types');

function readSource(file: string): string {
  return readFileSync(resolve(RUNTIME_TYPES, file), 'utf8');
}

function namesFromExportBlocks(src: string): Set<string> {
  const names = new Set<string>();
  for (const m of src.matchAll(/export\s+(?:interface|type)\s+([A-Z][A-Za-z0-9_]*)/g)) {
    if (m[1]) names.add(m[1]);
  }
  for (const m of src.matchAll(/export\s+type\s*\{\s*([^}]+)\s*\}\s*from/g)) {
    const body = (m[1] ?? '').replace(/\/\/[^\n]*\n/g, '\n');
    for (const raw of body.split(',')) {
      const name = raw.trim().split(/\s+as\s+/i)[0]?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

describe('public type exports', () => {
  it('every public type from runtime/types/*.ts is re-exported by the barrel', () => {
    const barrel = namesFromExportBlocks(readSource('index.ts'));

    const moduleFiles = readdirSync(RUNTIME_TYPES).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
    expect(moduleFiles.length).toBeGreaterThan(0);

    const definedTypes = new Set<string>();
    for (const file of moduleFiles) {
      for (const name of namesFromExportBlocks(readSource(file))) definedTypes.add(name);
    }

    const missing = [...definedTypes].filter((name) => !barrel.has(name)).sort();
    expect(missing, `Missing from src/runtime/types/index.ts barrel: ${missing.join(', ')}`).toEqual([]);
  });
});
