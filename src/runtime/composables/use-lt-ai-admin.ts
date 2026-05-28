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
  LtAiInteraction,
  LtAiPromptHint,
  LtAiPromptHintInput,
  LtAiSlot,
  LtAiSlotInput,
  UseLtAiAdminReturn,
} from '../types/ai';
import { ltAiRequest } from '../lib/ai';

export function useLtAiAdmin(): UseLtAiAdminReturn {
  return {
    // Connections
    createConnection: (input: LtAiConnectionInput) => ltAiRequest<LtAiConnection>('POST', '/connections', input),
    deleteConnection: (id: string) => ltAiRequest<LtAiConnection>('DELETE', `/connections/${id}`),
    detectCapabilities: (id: string) => ltAiRequest<LtAiConnection>('POST', `/connections/${id}/detect-capabilities`),
    getConnection: (id: string) => ltAiRequest<LtAiConnection>('GET', `/connections/${id}`),
    listConnections: () => ltAiRequest<LtAiConnection[]>('GET', '/connections'),
    updateConnection: (id: string, input: LtAiConnectionInput) => ltAiRequest<LtAiConnection>('PUT', `/connections/${id}`, input),

    // Connection preferences
    deletePreference: (id: string) => ltAiRequest<LtAiConnectionPreference>('DELETE', `/connections/preferences/${id}`),
    listPreferences: () => ltAiRequest<LtAiConnectionPreference[]>('GET', '/connections/preferences'),
    setPreference: (input: LtAiConnectionPreference) => ltAiRequest<LtAiConnectionPreference>('POST', '/connections/preferences', input),

    // Budget limits
    createBudgetLimit: (input: LtAiBudgetLimit) => ltAiRequest<LtAiBudgetLimit>('POST', '/budget-limits', input),
    deleteBudgetLimit: (id: string) => ltAiRequest<LtAiBudgetLimit>('DELETE', `/budget-limits/${id}`),
    listBudgetLimits: () => ltAiRequest<LtAiBudgetLimit[]>('GET', '/budget-limits'),
    updateBudgetLimit: (id: string, input: LtAiBudgetLimit) => ltAiRequest<LtAiBudgetLimit>('PUT', `/budget-limits/${id}`, input),

    // Prompt templates (admin-editable prompt building blocks)
    createSlot: (input: LtAiSlotInput) => ltAiRequest<LtAiSlot>('POST', '/slots', input),
    deleteSlot: (id: string) => ltAiRequest<LtAiSlot>('DELETE', `/slots/${id}`),
    listSlots: () => ltAiRequest<LtAiSlot[]>('GET', '/slots'),
    updateSlot: (id: string, input: LtAiSlotInput) => ltAiRequest<LtAiSlot>('PUT', `/slots/${id}`, input),

    // Learned prompt hints (governed self-improvement loop)
    createPromptHint: (input: LtAiPromptHintInput) => ltAiRequest<LtAiPromptHint>('POST', '/prompt-hints', input),
    deletePromptHint: (id: string) => ltAiRequest<LtAiPromptHint>('DELETE', `/prompt-hints/${id}`),
    listPromptHints: () => ltAiRequest<LtAiPromptHint[]>('GET', '/prompt-hints'),
    updatePromptHint: (id: string, input: LtAiPromptHintInput) => ltAiRequest<LtAiPromptHint>('PUT', `/prompt-hints/${id}`, input),

    // Audit
    listInteractions: () => ltAiRequest<LtAiInteraction[]>('GET', '/interactions'),
  };
}
