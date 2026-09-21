/**
 * Structured artifacts produced by modules 2..10.
 * Every artifact is plain JSON so agents can consume it directly.
 */

import type { ChoiceResult, NoulResult, ScoreResult } from "./types.js";

/* Module 2: Ultra-Planning ------------------------------------------------ */

export interface PlanTask {
  id: string;
  title: string;
  detail: string;
  dependsOn: string[];
  acceptance: string[];
  estimate: "S" | "M" | "L";
}

export interface PlanArtifact {
  goal: string;
  preset: string | null;
  hypothesis: { source: "llm" | "offline-fallback"; architecture: string[] };
  antiThesis: { source: "llm" | "offline-fallback"; failureModes: string[] };
  dimensions: {
    feasibility: ScoreResult;
    risk: NoulResult;
    cost: ScoreResult;
    maintainability: ScoreResult;
  };
  verdict: {
    go: boolean;
    compositeScore: number;
    confidence: number;
    rationale: string;
  };
  tasks: PlanTask[];
  riskRegister: Array<{ risk: string; likelihood: NoulResult; mitigation: string }>;
  /** Total wall-clock time of the pipeline in ms (Jev loop included). */
  totalLatencyMs: number;
  estimatedCostUsd: number;
}

/* Module 3: Adversarial Red-Teaming -------------------------------------- */

export interface RedTeamReport {
  thesis: string;
  antiTheses: Array<{ id: string; statement: string; severity: NoulResult }>;
  /** Thesis vs anti-thesis arbitration result. */
  arbitration: ChoiceResult;
  winner: "thesis" | "anti-thesis";
  scoreboard: Array<{ id: string; statement: string; score: ScoreResult }>;
  residualRisks: string[];
  mitigations: string[];
  latencyMs: number;
}

/* Module 4: 360° Audit ---------------------------------------------------- */

export type AuditDimensionId =
  | "architecture"
  | "security"
  | "marketing"
  | "legal"
  | "budget";

export interface AuditFinding {
  dimension: AuditDimensionId;
  severity: "critical" | "high" | "medium" | "low" | "info";
  message: string;
  evidence: string;
  recommendation: string;
}

export interface AuditDimension {
  id: AuditDimensionId;
  score: ScoreResult;
  findings: AuditFinding[];
}

export interface AuditReport {
  root: string;
  presetNotes: string[];
  dimensions: AuditDimension[];
  topActions: Array<{ action: string; impact: ScoreResult }>;
  scannedFiles: number;
  latencyMs: number;
}

/* Module 5: Deep research + Winnow compaction ----------------------------- */

export type ResearchChannelId = "web" | "academic" | "code" | "social";

export interface ResearchHit {
  channel: ResearchChannelId;
  title: string;
  url: string;
  snippet: string;
  /** Jev Noul relevance in [0, 1]. */
  relevance?: number;
  source: "network" | "offline-fallback";
}

export interface ResearchBrief {
  query: string;
  channels: ResearchChannelId[];
  hits: ResearchHit[];
  ranked: ResearchHit[];
  synthesis: { source: "llm" | "offline-fallback"; brief: string; citations: string[] };
  latencyMs: number;
}

/* Module 5b (extension): transcript-aware Winnow --------------------------- */

export interface TranscriptToolCall {
  tool_use_id: string;
  tool: string;
  input?: unknown;
}

export interface TranscriptToolResult {
  tool_use_id: string;
  text: string;
}

export interface TranscriptMessage {
  role: string;
  text?: string;
  toolCalls?: TranscriptToolCall[];
  toolResults?: TranscriptToolResult[];
}

export interface TranscriptCompactionReport {
  totalMessages: number;
  outputMessages: number;
  totalPairs: number;
  keptCalls: number;
  truncatedResults: number;
  droppedPairs: number;
  /** Pairs where an anchor (path/command/error/url/diff) overrode a Noul "drop" verdict. */
  anchorOverrides: number;
  bytesIn: number;
  bytesOut: number;
  messages: TranscriptMessage[];
  latencyMs: number;
}

/* Module — Gatekeeper calibration check ------------------------------------ */

export interface CalibrationCase {
  question: string;
  options: string[];
  correctIndex: number;
  state?: string;
}

export interface CalibrationBucket {
  range: string;
  count: number;
  avgConfidence: number;
  accuracy: number;
  /** avgConfidence - accuracy. Positive = overconfident, negative = underconfident. */
  calibrationGap: number;
}

export interface OrderBiasExample {
  question: string;
  originalSelected: string;
  reversedSelected: string;
}

export interface CalibrationReport {
  totalCases: number;
  overallAccuracy: number;
  buckets: CalibrationBucket[];
  orderBias: {
    testedCases: number;
    flippedCount: number;
    flipRate: number;
    examples: OrderBiasExample[];
  };
  recommendation: string;
  backend: string;
}

/* Module — Competitor / market scan --------------------------------------- */

export interface CompetitorCandidate {
  fullName: string;
  url: string;
  description: string;
  stars: number;
  language: string | null;
  createdAt: string;
  pushedAt: string;
  /** Jev Noul "competes with us" relevance in [0, 1]. */
  relevance: number;
  tier: "VERIFIED" | "PROBABLE" | "REJECTED";
}

export interface CompetitorReport {
  query: string;
  windowDays: number;
  ourRepo: string | null;
  candidates: CompetitorCandidate[];
  synthesis: { source: "llm" | "offline-fallback"; brief: string };
  latencyMs: number;
}

export interface CompactionReport {
  keptLines: number;
  droppedLines: number;
  bytesIn: number;
  bytesOut: number;
  /** protected anchors are never dropped: file paths, commands, error codes, URLs, diff headers. */
  preservedAnchors: string[];
  compacted: string;
  droppedSample: string[];
  method: "winnow";
  latencyMs: number;
}

/* Module 6: GitHub miner / clean-room ------------------------------------- */

export type LicenseClass = "permissive" | "copyleft" | "proprietary" | "unknown";

export interface LicenseVerdict {
  spdx: string;
  klass: LicenseClass;
  copyAllowed: boolean;
  reason: string;
}

export interface MiningReport {
  repo: string;
  license: LicenseVerdict;
  /** Abstracted design patterns (clean-room: metadata only, never source text). */
  architectureNotes: string[];
  cleanRoomSpec: {
    required: boolean;
    spec: string[];
    originalCodePrompt: string;
  };
  /** Max 5-gram Jaccard similarity guard, computed against sampled upstream text. */
  similarity: { jaccard: number; threshold: number; pass: boolean; sampledFiles: number };
  latencyMs: number;
}

/* Module 7: Training kit -------------------------------------------------- */

export interface DatasetLabel {
  input: string;
  label:
    | { kind: "choice"; value: string; confidence: number }
    | { kind: "score"; value: number }
    | { kind: "noul"; value: number };
  backend: string;
  costUsd: number;
}

export interface PreferencePair {
  prompt: string;
  chosen: string;
  rejected: string;
  chosenScore: number;
  rejectedScore: number;
  rationale: string;
}

export interface DistillRecipe {
  target: "qwen2.5-0.5b" | "modernbert-421m" | "custom";
  method: "lora" | "full";
  lora: { r: number; alpha: number; dropout: number; targetModules: string[] } | null;
  hyperparameters: {
    epochs: number;
    lr: number;
    batchSize: number;
    maxSeqLen: number;
    warmupRatio: number;
  };
  datasetFormat: "jsonl-chat" | "jsonl-dpo";
  commands: string[];
  notes: string[];
}

/* Module 8: Self-improver (RLVR) ------------------------------------------ */

export interface VerificationCommandResult {
  command: string;
  exitCode: number;
  durationMs: number;
  tail: string;
}

export interface VerificationResult {
  cwd: string;
  passed: boolean;
  reward: 1 | -1;
  commands: VerificationCommandResult[];
  policyUpdate: {
    before: { executeThreshold: number; escalateThreshold: number };
    after: { executeThreshold: number; escalateThreshold: number };
    changed: boolean;
    reason: string;
  };
}

/* Module 9: Chief of staff + guardrail ------------------------------------ */

export type AgentRole =
  | "researcher"
  | "planner"
  | "implementer"
  | "reviewer"
  | "writer"
  | "auditor";

export interface DispatchDecision {
  task: string;
  roleChoice: ChoiceResult;
  role: AgentRole;
  handoff: {
    to: AgentRole;
    payload: { task: string; context: string[]; requiredTools: string[] };
  };
  nextSteps: string[];
}

export interface GuardrailVerdict {
  tool: string;
  args: string;
  decision: "allow" | "ask" | "block";
  danger: NoulResult;
  severity: ScoreResult;
  matchedRules: string[];
  reason: string;
}

/* Module 10: Enterprise features ------------------------------------------ */

export interface FeatureDescriptor {
  id: number;
  slug: string;
  name: string;
  status: "implemented" | "scaffolded";
  tool: string | null;
  summary: string;
}

export interface SanitizeReport {
  sanitized: string;
  detections: Array<{ kind: string; count: number; sample: string }>;
  totalRedactions: number;
  safeForExternalModel: boolean;
}

/* Module — Claude Skills discovery & routing ------------------------------ */

export type SkillSource = "self" | "project" | "user" | "plugin-cache" | "plugin-marketplace";

export interface SkillEntry {
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  installed: true;
}

/**
 * One marketplace-listed plugin not yet installed locally. Represents a whole
 * plugin (marketplace.json granularity, which may bundle >=1 skill) — we only
 * have plugin-level metadata for anything we haven't installed.
 */
export interface CatalogSkillEntry {
  name: string;
  description: string;
  marketplace: string;
  homepage?: string;
  uniqueInstalls?: number;
  /** True when this entry came from the public fallback fetch, not a local marketplace.json. */
  viaRemoteFallback: boolean;
  installed: false;
}

export interface SkillMatch<T> {
  entry: T;
  relevance: ScoreResult;
  installCommand?: string[];
}

export interface SkillRouterReport {
  task: string;
  zone: "execute" | "speculative";
  matches: Array<SkillMatch<SkillEntry>>;
  catalogMatches: Array<SkillMatch<CatalogSkillEntry>>;
  scannedDirs: string[];
  usedRemoteCatalog: boolean;
  latencyMs: number;
}
