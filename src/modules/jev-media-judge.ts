/**
 * MODULE — Media judge: decouples "seeing" from "deciding".
 *
 * The Jev-Omni discussion (2026-09-23) surfaced a real gap: a genuinely
 * multimodal Jev-style model exists, but needs ~25GB VRAM most people don't
 * have. Instead of waiting on that, this module accepts a TEXT description
 * of a video/image/clip — already produced by whatever vision LLM the
 * caller has access to (Claude/Gemini/GPT vision, already $0-marginal-cost
 * for most integrations, e.g. Lunatic's existing clip-analysis) — and does
 * the CALIBRATED classification step with jev's own Choice/Score primitives
 * instead of trusting the vision LLM's own self-reported, unverified rating.
 *
 * This is strictly an accuracy/reliability layer on top of an existing
 * vision call, not a replacement for one — jev's primitives never generate
 * free text, so "seeing" and writing actionable coaching tips still needs a
 * real vision-capable LLM. What this adds: an independent, calibrated
 * second opinion on the structured rating, decoupled from whatever the
 * vision model claimed about itself.
 */

import type { ChoiceResult, JevBackend, ScoreResult } from "../core/types.js";
import type { MediaJudgeResult } from "../core/module-types.js";

export interface MediaJudgeDeps {
  backend: JevBackend;
}

const DEFAULT_RATING_OPTIONS = ["good", "average", "bad"];

export class MediaJudge {
  constructor(private readonly deps: MediaJudgeDeps) {}

  async judge(
    context: string,
    description: string,
    opts: { ratingOptions?: string[]; scoreLabel?: string } = {},
  ): Promise<MediaJudgeResult> {
    const started = Date.now();
    const ratingOptions = opts.ratingOptions ?? DEFAULT_RATING_OPTIONS;
    const scoreLabel = opts.scoreLabel ?? "overall skill/quality shown";
    const state = `context: ${context}\nvision description: ${description}`;

    const [rating, score] = (await this.deps.backend.batch([
      {
        kind: "choice",
        question: "Based only on what's described, which category best fits the performance/quality shown?",
        options: ratingOptions,
        state,
      },
      {
        kind: "score",
        question: `Rate the ${scoreLabel} on a 1-10 scale, based only on what's described.`,
        min: 1,
        max: 10,
        state,
      },
    ])) as [ChoiceResult, ScoreResult];

    return {
      context,
      description,
      rating,
      score,
      latencyMs: Date.now() - started,
    };
  }
}
