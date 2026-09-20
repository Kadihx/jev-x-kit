/**
 * Core primitive + decision types for the JEV Super Agent framework.
 *
 * The kit is built on three non-autoregressive decision primitives:
 *  - Choice : pick one option out of a defined group (up to 255 options)
 *  - Score  : fractional value on an ordered 1..10 scale
 *  - Noul   : calibrated Bernoulli probability in [0, 1]
 */

export type PrimitiveKind = "choice" | "score" | "noul";

export interface JevUsage {
  /** Rough input-token estimate (chars / 4). */
  inputTokens: number;
  /** USD cost of the call. 0 for local/heuristic backends, $0.042 / 1M tokens for hosted Jev. */
  costUsd: number;
  /** Effective pricing used for the estimate (documented per backend). */
  pricePerMillionUsd: number;
}

export interface PrimitiveBase {
  id: string;
  kind: PrimitiveKind;
  question: string;
  backend: string;
  /** Wall-clock latency of the evaluation, measured locally. */
  latencyMs: number;
  usage: JevUsage;
  /** Schema validation status. Hosted/OpenJev responses are validated; the kit never trusts raw text. */
  schemaValid: boolean;
  /** True when the result came from a deterministic offline fallback instead of a real model backend. */
  synthetic: boolean;
}

export interface ChoiceResult extends PrimitiveBase {
  kind: "choice";
  options: string[];
  selectedIndex: number;
  selected: string;
  /** Calibrated distribution over the option group; length === options.length, sums to ~1. */
  probabilities: number[];
  /** max(probabilities) — calibrated top-1 confidence. */
  confidence: number;
}

export interface ScoreResult extends PrimitiveBase {
  kind: "score";
  min: number;
  max: number;
  /** Fractional score on [min, max] (e.g. 1.035 on a 1..10 scale). */
  score: number;
  confidence: number;
  signals: string[];
}

export interface NoulResult extends PrimitiveBase {
  kind: "noul";
  /** Calibrated probability of "yes" in [0, 1]. */
  probability: number;
  /** Distance from maximum entropy, [0, 1]: 1 = fully decided, 0 = coin flip. */
  confidence: number;
  signals: string[];
}

export type JevResult = ChoiceResult | ScoreResult | NoulResult;

export const CHOICE_MAX_OPTIONS = 255;

/* ------------------------------------------------------------------ */
/* Gatekeeper                                                          */
/* ------------------------------------------------------------------ */

export type DecisionRoute = "execute" | "speculative" | "system2";

export interface GatekeeperPolicy {
  /** confidence > executeThreshold -> run code/tool directly ($0 LLM cost). */
  executeThreshold: number;
  /** escalateThreshold..executeThreshold -> speculative escalation (split into sub-decisions). */
  escalateThreshold: number;
}

export const DEFAULT_GATEKEEPER_POLICY: GatekeeperPolicy = {
  executeThreshold: 0.85,
  escalateThreshold: 0.6,
};

export interface GatekeeperDecision {
  question: string;
  route: DecisionRoute;
  confidence: number;
  policy: GatekeeperPolicy;
  /** "BELKİ" zone marker: true when confidence < escalateThreshold. */
  belki: boolean;
  reason: string;
  /** Sub-decisions produced for speculative escalation. */
  subDecisions?: Array<{ question: string; options: string[] }>;
  /** System-2 payload when the request escalates to an LLM or a human. */
  escalation?: { target: "llm" | "human"; payload: string };
}

/* ------------------------------------------------------------------ */
/* Backend contract                                                    */
/* ------------------------------------------------------------------ */

export interface ChoiceRequest {
  kind: "choice";
  id?: string;
  question: string;
  options: string[];
  /** Extra ordered context (never rewritten, only appended as-is). */
  state?: string;
}

export interface ScoreRequest {
  kind: "score";
  id?: string;
  question: string;
  min?: number;
  max?: number;
  state?: string;
}

export interface NoulRequest {
  kind: "noul";
  id?: string;
  question: string;
  state?: string;
}

export type JevRequest = ChoiceRequest | ScoreRequest | NoulRequest;

export interface BackendMeta {
  id: string;
  label: string;
  /** USD per 1M input tokens; 0 means fully free/local. */
  pricePerMillionUsd: number;
  /** Non-autoregressive Jev backends have zero output-token cost. */
  outputTokenCostUsd: 0;
  local: boolean;
  synthetic: boolean;
}

export interface JevBackend {
  readonly meta: BackendMeta;
  /** Cheap reachability probe; heuristic backend is always healthy. */
  health(): Promise<boolean>;
  choice(req: ChoiceRequest): Promise<ChoiceResult>;
  score(req: ScoreRequest): Promise<ScoreResult>;
  noul(req: NoulRequest): Promise<NoulResult>;
  /** Extensible fan-out: evaluate an arbitrary batch in one pass. */
  batch(requests: JevRequest[]): Promise<JevResult[]>;
}

export type BackendProviderId =
  | "auto"
  | "typesafe_jev"
  | "openjev_local"
  | "laya_local"
  | "heuristic";

/* ------------------------------------------------------------------ */
/* Persistent memory (.jev-skill-memory.json)                          */
/* ------------------------------------------------------------------ */

export interface CalibrationBucket {
  /** Inclusive lower bound of the confidence range. */
  from: number;
  /** Exclusive upper bound of the confidence range (1.0 for the last bucket). */
  to: number;
  predictedAvg: number;
  /** Observed success rate for stored outcomes in this bucket. */
  observedRate: number;
  n: number;
}

export interface MemoryEvent {
  at: string;
  kind: "success" | "failure" | "decision";
  route?: DecisionRoute;
  confidence?: number;
  question?: string;
  detail: string;
  reward?: 1 | -1 | 0;
}

export interface SkillMemory {
  version: 1;
  createdAt: string;
  updatedAt: string;
  /** Auto-tuned gatekeeper thresholds (module 8 -> module 1 feedback loop). */
  policy: GatekeeperPolicy;
  stats: {
    decisions: number;
    executed: number;
    speculative: number;
    escalated: number;
    successes: number;
    failures: number;
    reward: number;
  };
  calibration: CalibrationBucket[];
  events: MemoryEvent[];
}
