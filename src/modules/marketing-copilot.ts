/**
 * MODULE — Marketing Copilot (ad copy + sales-call triage).
 *
 * ad_copy mode: one batched Score pass (hookStrength/clarity/emotionalResonance)
 * plus one batched Choice pass (primaryTrigger) over every variant.
 * sales_call mode: one Choice (objectionType) + one Noul (buyingSignalPresent)
 * on the transcript chunk.
 */

import { round } from "../core/text.js";
import type { ChoiceResult, JevBackend, NoulResult, ScoreResult } from "../core/types.js";
import type {
  AdCopyItemReport,
  AdCopyReport,
  MarketingTriageReport,
  SalesCallReport,
} from "../core/module-types.js";

export interface MarketingCopilotDeps {
  backend: JevBackend;
}

export type MarketingTriageInput =
  | { mode: "ad_copy"; adVariants: string[] }
  | { mode: "sales_call"; transcriptChunk: string };

const TRIGGER_OPTIONS = ["fear", "curiosity", "urgency", "gain"];
const OBJECTION_OPTIONS = ["price", "timing", "competitor", "authority", "feature-gap"];

export class MarketingCopilot {
  constructor(private readonly deps: MarketingCopilotDeps) {}

  async triage(input: MarketingTriageInput): Promise<MarketingTriageReport> {
    if (input.mode === "ad_copy") return this.triageAdCopy(input.adVariants);
    return this.triageSalesCall(input.transcriptChunk);
  }

  private async triageAdCopy(adVariants: string[]): Promise<AdCopyReport> {
    const started = Date.now();

    const scoreRequests = adVariants.flatMap((variant) => [
      { kind: "score" as const, question: "How strong is this ad copy's hook (attention-grabbing opener)?", min: 1, max: 10, state: `ad copy: ${variant}` },
      { kind: "score" as const, question: "How clear is this ad copy (easy to understand at a glance)?", min: 1, max: 10, state: `ad copy: ${variant}` },
      { kind: "score" as const, question: "How emotionally resonant is this ad copy?", min: 1, max: 10, state: `ad copy: ${variant}` },
    ]);
    const scores = (await this.deps.backend.batch(scoreRequests)) as ScoreResult[];

    const triggerRequests = adVariants.map((variant) => ({
      kind: "choice" as const,
      question: "What is the primary persuasion trigger this ad copy leans on?",
      options: TRIGGER_OPTIONS,
      state: `ad copy: ${variant}`,
    }));
    const triggers = (await this.deps.backend.batch(triggerRequests)) as ChoiceResult[];

    const items: AdCopyItemReport[] = adVariants.map((variant, i) => {
      const hookStrength = scores[i * 3]!;
      const clarity = scores[i * 3 + 1]!;
      const emotionalResonance = scores[i * 3 + 2]!;
      const primaryTrigger = triggers[i]!;
      return {
        variant,
        index: i,
        hookStrength,
        clarity,
        emotionalResonance,
        primaryTrigger,
        recommendation: adCopyRecommendation(i, primaryTrigger, hookStrength, clarity, emotionalResonance),
      };
    });

    return { mode: "ad_copy", items, latencyMs: Date.now() - started };
  }

  private async triageSalesCall(transcriptChunk: string): Promise<SalesCallReport> {
    const started = Date.now();
    const state = `transcript: ${transcriptChunk}`;

    const [objectionType, buyingSignalPresent] = (await this.deps.backend.batch([
      {
        kind: "choice",
        question: "What type of objection is the prospect raising in this transcript?",
        options: OBJECTION_OPTIONS,
        state,
      },
      {
        kind: "noul",
        question: "Is there a genuine buying signal present in this transcript?",
        state,
      },
    ])) as [ChoiceResult, NoulResult];

    return {
      mode: "sales_call",
      transcriptChunk,
      objectionType,
      buyingSignalPresent,
      recommendation: salesCallRecommendation(objectionType, buyingSignalPresent),
      latencyMs: Date.now() - started,
    };
  }
}

function adCopyRecommendation(
  index: number,
  trigger: ChoiceResult,
  hookStrength: ScoreResult,
  clarity: ScoreResult,
  emotionalResonance: ScoreResult,
): string {
  const weak = [
    hookStrength.score < 5 ? "hook is weak" : null,
    clarity.score < 5 ? `clarity is low (${round(clarity.score, 1)}/10)` : null,
    emotionalResonance.score < 5 ? "low emotional resonance" : null,
  ].filter((x): x is string => x !== null);
  const strengthLabel =
    Math.max(hookStrength.score, clarity.score, emotionalResonance.score) >= 7
      ? `strong ${trigger.selected} hook`
      : `moderate ${trigger.selected} appeal`;

  return weak.length
    ? `variant ${index + 1}: ${strengthLabel}, but ${weak.join(", ")} — tighten the CTA`
    : `variant ${index + 1}: ${strengthLabel} across the board — ready to test`;
}

function salesCallRecommendation(objectionType: ChoiceResult, buyingSignal: NoulResult): string {
  const signalNote = buyingSignal.probability >= 0.5 ? "buying signal present" : "no clear buying signal yet";
  return `objection: ${objectionType.selected} (confidence ${round(objectionType.confidence, 2)}) — ${signalNote}, prep a ${objectionType.selected}-specific rebuttal`;
}
