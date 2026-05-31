/**
 * Admin data layer for the AI module (headless): CRUD for connections,
 * connection preferences and budget limits, capability auto-detection, and the
 * interaction audit log. All endpoints are ADMIN-gated server-side.
 *
 * Pair with your own UI (the nuxt-base-starter ships a reference admin area).
 */

import type {
  LtAiBudgetLimit,
  LtAiConnection,
  LtAiConnectionInput,
  LtAiConnectionPreference,
  LtAiEffectiveSlot,
  LtAiInteraction,
  LtAiPromptHint,
  LtAiPromptHintInput,
  LtAiSlot,
  LtAiSlotInput,
  UseLtAiAdminReturn,
} from '../types/ai';
import { ltAiRequest } from '../lib/ai';

/** Encode an id segment for safe interpolation into a URL path (defense-in-depth). */
const seg = (id: string): string => encodeURIComponent(id);

export function useLtAiAdmin(): UseLtAiAdminReturn {
  return {
    // Connections
    createConnection: (input: LtAiConnectionInput) => ltAiRequest<LtAiConnection>('POST', '/connections', input),
    deleteConnection: (id: string) => ltAiRequest<LtAiConnection>('DELETE', `/connections/${seg(id)}`),
    detectCapabilities: (id: string) => ltAiRequest<LtAiConnection>('POST', `/connections/${seg(id)}/detect-capabilities`),
    getConnection: (id: string) => ltAiRequest<LtAiConnection>('GET', `/connections/${seg(id)}`),
    listConnections: () => ltAiRequest<LtAiConnection[]>('GET', '/connections'),
    updateConnection: (id: string, input: LtAiConnectionInput) => ltAiRequest<LtAiConnection>('PUT', `/connections/${seg(id)}`, input),

    // Connection preferences
    deletePreference: (id: string) => ltAiRequest<LtAiConnectionPreference>('DELETE', `/connections/preferences/${seg(id)}`),
    listPreferences: () => ltAiRequest<LtAiConnectionPreference[]>('GET', '/connections/preferences'),
    setPreference: (input: LtAiConnectionPreference) => ltAiRequest<LtAiConnectionPreference>('POST', '/connections/preferences', input),

    // Budget limits
    createBudgetLimit: (input: LtAiBudgetLimit) => ltAiRequest<LtAiBudgetLimit>('POST', '/budget-limits', input),
    deleteBudgetLimit: (id: string) => ltAiRequest<LtAiBudgetLimit>('DELETE', `/budget-limits/${seg(id)}`),
    listBudgetLimits: () => ltAiRequest<LtAiBudgetLimit[]>('GET', '/budget-limits'),
    updateBudgetLimit: (id: string, input: LtAiBudgetLimit) => ltAiRequest<LtAiBudgetLimit>('PUT', `/budget-limits/${seg(id)}`, input),

    // System-prompt slots (admin-editable; tenant-scoped)
    createSlot: (input: LtAiSlotInput) => ltAiRequest<LtAiSlot>('POST', '/slots', input),
    deleteSlot: (id: string) => ltAiRequest<LtAiSlot>('DELETE', `/slots/${seg(id)}`),
    listEffectiveSlots: () => ltAiRequest<LtAiEffectiveSlot[]>('GET', '/slots/effective'),
    listSlots: () => ltAiRequest<LtAiSlot[]>('GET', '/slots'),
    resetSlot: (id: string) => ltAiRequest<boolean>('POST', `/slots/${seg(id)}/reset`),
    updateSlot: (id: string, input: LtAiSlotInput) => ltAiRequest<LtAiSlot>('PUT', `/slots/${seg(id)}`, input),

    // Learned prompt hints (governed self-improvement loop)
    createPromptHint: (input: LtAiPromptHintInput) => ltAiRequest<LtAiPromptHint>('POST', '/prompt-hints', input),
    deletePromptHint: (id: string) => ltAiRequest<LtAiPromptHint>('DELETE', `/prompt-hints/${seg(id)}`),
    listPromptHints: () => ltAiRequest<LtAiPromptHint[]>('GET', '/prompt-hints'),
    updatePromptHint: (id: string, input: LtAiPromptHintInput) => ltAiRequest<LtAiPromptHint>('PUT', `/prompt-hints/${seg(id)}`, input),

    // Audit
    listInteractions: () => ltAiRequest<LtAiInteraction[]>('GET', '/interactions'),
  };
}
