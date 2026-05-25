// =============================================================================
// AI Assistant Types
// =============================================================================
// Mirror the @lenne.tech/nest-server AI module API (REST + SSE). Kept loose
// where the backend payload is open-ended (data, results) so consumers stay
// forward-compatible across nest-server minor versions.

import type { ComputedRef, DeepReadonly, Ref } from 'vue';

/** Execution mode for a prompt. `auto` = reactive agent loop, `plan` = validate-all-then-execute. */
export type LtAiMode = 'auto' | 'plan';

/** Input for a prompt sent to the AI assistant (`POST /ai/prompt` | `/ai/stream`). */
export interface LtAiPromptInput {
  /** Confirm execution of actions that required confirmation in a previous turn. */
  confirm?: boolean;
  /** Id of the connection to use (omit to let the backend resolution chain decide). */
  connectionId?: string;
  /** Conversation id for multi-turn continuation. */
  conversationId?: string;
  /** Structured context the assistant should consider. */
  context?: Record<string, any>;
  /** Untrusted client metadata (current URL, navigation, console logs) for enrichment. */
  metadata?: Record<string, any>;
  /** Execution mode (defaults to the backend's `ai.defaultMode`). */
  mode?: LtAiMode;
  /** The user's prompt text. */
  prompt: string;
  /** Override the admin default for requiring confirmation of mutating actions. */
  requireConfirmation?: boolean;
}

/** A tool action executed (or planned/pending) during a run. */
export interface LtAiAction {
  arguments?: Record<string, any>;
  name: string;
  result?: any;
  success?: boolean;
}

/** Token usage of a single run (best effort). */
export interface LtAiUsage {
  completionTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
}

/** Compact token-budget summary attached to every response. */
export interface LtAiBudgetSummary {
  promptTokens?: number;
  remainingTokens?: number;
  resetAt?: string;
  usedTokens?: number;
}

/** Structured response of a prompt run (`CoreAiResponse`). */
export interface LtAiResponse {
  actions?: LtAiAction[];
  budget?: LtAiBudgetSummary;
  connectionId?: string;
  conversationId?: string;
  data?: any;
  denied?: boolean;
  deniedActions?: LtAiAction[];
  iterations?: number;
  pendingActions?: LtAiAction[];
  plan?: LtAiAction[];
  requiresConfirmation?: boolean;
  text: string;
  usage?: LtAiUsage;
}

/** Server-sent event emitted by `POST /ai/stream`. */
export type LtAiStreamEvent =
  | { action: LtAiAction; type: 'action' }
  | { message: string; type: 'error' }
  | { response: LtAiResponse; type: 'final' }
  | { token: string; type: 'token' };

/** Callbacks for {@link UseLtAiReturn.promptStream}. */
export interface LtAiStreamHandlers {
  onAction?: (action: LtAiAction) => void;
  onError?: (message: string) => void;
  onEvent?: (event: LtAiStreamEvent) => void;
  onFinal?: (response: LtAiResponse) => void;
  onToken?: (token: string) => void;
}

/** A single chat message in {@link UseLtAiChatReturn}. */
export interface LtAiMessage {
  actions?: LtAiAction[];
  budget?: LtAiBudgetSummary;
  content: string;
  createdAt?: string;
  denied?: boolean;
  error?: boolean;
  /** Pending actions awaiting confirmation (assistant turns only). */
  pendingActions?: LtAiAction[];
  /** Whether this assistant turn is still streaming. */
  pending?: boolean;
  /** Whether this assistant turn awaits a confirmation to proceed. */
  requiresConfirmation?: boolean;
  role: 'assistant' | 'user';
}

/** A non-sensitive connection the current user/tenant may use. */
export interface LtAiAvailableConnection {
  id: string;
  isDefault?: boolean;
  locked?: boolean;
  model?: string;
  name?: string;
  selected?: boolean;
}

/** Usage for a single scope (user or tenant). */
export interface LtAiUsageScope {
  maxPrompts?: number;
  maxTokens?: number;
  period: string;
  refId?: string;
  remainingPrompts?: number;
  remainingTokens?: number;
  resetAt?: string;
  scope: string;
  usedPrompts: number;
  usedTokens: number;
}

/** Full usage info (`GET /ai/usage`). */
export interface LtAiUsageInfo {
  tenant?: LtAiUsageScope;
  user?: LtAiUsageScope;
}

// =============================================================================
// Admin types (connections, preferences, budgets, audit)
// =============================================================================

/** Admin view of a connection (`apiKey` is never returned — only `hasApiKey`). */
export interface LtAiConnection {
  apiKeyEnv?: string;
  baseUrl?: string;
  capabilities?: string[];
  defaultMaxTokens?: number;
  defaultTemperature?: number;
  description?: string;
  enabled?: boolean;
  enforced?: boolean;
  enforcedTenantIds?: string[];
  hasApiKey?: boolean;
  id: string;
  isDefault?: boolean;
  model?: string;
  name?: string;
  providerType?: string;
  supportsJsonResponse?: boolean;
  supportsNativeTools?: boolean;
  supportsVision?: boolean;
  tenantIds?: string[];
}

/** Input to create/update a connection (`apiKey`: value sets, '' clears, omit leaves). */
export interface LtAiConnectionInput {
  apiKey?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  defaultMaxTokens?: number;
  defaultTemperature?: number;
  description?: string;
  enabled?: boolean;
  enforced?: boolean;
  enforcedTenantIds?: string[];
  isDefault?: boolean;
  model?: string;
  name?: string;
  providerType?: string;
  supportsJsonResponse?: boolean;
  supportsNativeTools?: boolean;
  supportsVision?: boolean;
  tenantIds?: string[];
}

/** A tenant/user connection preference. */
export interface LtAiConnectionPreference {
  connectionId: string;
  enforced?: boolean;
  id?: string;
  refId: string;
  scope: 'tenant' | 'user';
}

/** A per-user/per-tenant budget-limit override. */
export interface LtAiBudgetLimit {
  id?: string;
  maxPrompts?: number;
  maxTokens?: number;
  period?: 'day' | 'month' | 'none';
  refId: string;
  scope: 'tenant' | 'user';
}

/** An AI interaction audit record. */
export interface LtAiInteraction {
  actions?: { name: string; success: boolean }[];
  completionTokens?: number;
  connectionId?: string;
  createdAt?: string;
  id: string;
  iterations?: number;
  prompt?: string;
  promptTokens?: number;
  responseText?: string;
  tenantId?: string;
  totalTokens?: number;
  userId?: string;
}

// =============================================================================
// Composable return types
// =============================================================================

export interface UseLtAiReturn {
  error: DeepReadonly<Ref<null | string>>;
  loading: DeepReadonly<Ref<boolean>>;
  prompt: (input: LtAiPromptInput) => Promise<LtAiResponse>;
  promptStream: (input: LtAiPromptInput, handlers?: LtAiStreamHandlers, options?: { signal?: AbortSignal }) => Promise<LtAiResponse | undefined>;
  streaming: DeepReadonly<Ref<boolean>>;
}

export interface UseLtAiChatOptions {
  /** Fixed connection id (or a ref) to use for every turn. */
  connectionId?: Ref<string | undefined> | string;
  /** Existing conversation id to continue. */
  conversationId?: string;
  /** Whether to stream responses (default true). */
  stream?: boolean;
  /** Execution mode for every turn. */
  mode?: LtAiMode;
  /** Producer for per-turn client metadata (e.g. current URL). */
  metadata?: () => Record<string, any>;
}

export interface UseLtAiChatReturn {
  budget: DeepReadonly<Ref<LtAiBudgetSummary | null>>;
  clear: () => void;
  confirm: () => Promise<void>;
  conversationId: DeepReadonly<Ref<string | undefined>>;
  error: DeepReadonly<Ref<null | string>>;
  // Shallow readonly: the ref cannot be reassigned, but message elements stay
  // bindable to child components (avoids DeepReadonly friction in consumers).
  messages: Readonly<Ref<LtAiMessage[]>>;
  requiresConfirmation: ComputedRef<boolean>;
  send: (content: string) => Promise<void>;
  stop: () => void;
  streaming: DeepReadonly<Ref<boolean>>;
}

export interface UseLtAiConnectionsReturn {
  connections: DeepReadonly<Ref<LtAiAvailableConnection[]>>;
  error: DeepReadonly<Ref<null | string>>;
  loading: DeepReadonly<Ref<boolean>>;
  load: () => Promise<void>;
  locked: ComputedRef<boolean>;
  select: (connectionId: string) => Promise<void>;
  selected: ComputedRef<LtAiAvailableConnection | undefined>;
}

export interface UseLtAiUsageReturn {
  error: DeepReadonly<Ref<null | string>>;
  loading: DeepReadonly<Ref<boolean>>;
  load: () => Promise<void>;
  usage: DeepReadonly<Ref<LtAiUsageInfo | null>>;
}

export interface UseLtAiAdminReturn {
  createBudgetLimit: (input: LtAiBudgetLimit) => Promise<LtAiBudgetLimit>;
  createConnection: (input: LtAiConnectionInput) => Promise<LtAiConnection>;
  deleteBudgetLimit: (id: string) => Promise<LtAiBudgetLimit>;
  deleteConnection: (id: string) => Promise<LtAiConnection>;
  deletePreference: (id: string) => Promise<LtAiConnectionPreference>;
  detectCapabilities: (id: string) => Promise<LtAiConnection>;
  getConnection: (id: string) => Promise<LtAiConnection>;
  listBudgetLimits: () => Promise<LtAiBudgetLimit[]>;
  listConnections: () => Promise<LtAiConnection[]>;
  listInteractions: () => Promise<LtAiInteraction[]>;
  listPreferences: () => Promise<LtAiConnectionPreference[]>;
  setPreference: (input: LtAiConnectionPreference) => Promise<LtAiConnectionPreference>;
  updateBudgetLimit: (id: string, input: LtAiBudgetLimit) => Promise<LtAiBudgetLimit>;
  updateConnection: (id: string, input: LtAiConnectionInput) => Promise<LtAiConnection>;
}
