/**
 * MODULE — JARVIS-style intent triage.
 *
 * Ultra-fast front door for any command-bar / voice-assistant / chatbot
 * style surface: one Noul (is this directly executable?) + one Choice
 * (which category?) fan-out call decides whether the request can be routed
 * locally at $0 or needs to escalate to a full System-2 LLM turn. No new
 * concept — same BELKİ gatekeeper zone semantics as `jev_decide`, just
 * specialized to a fixed JARVIS-style intent taxonomy.
 */

import type { ChoiceResult, JevBackend, NoulResult } from "../core/types.js";
import { JARVIS_INTENT_CATEGORIES, type JarvisTriageResult } from "../core/module-types.js";

export interface JarvisIntentTriageDeps {
  backend: JevBackend;
}

const EXECUTABLE_THRESHOLD = 0.6;
const CATEGORY_CONFIDENCE_THRESHOLD = 0.6;

export class JarvisIntentTriage {
  constructor(private readonly deps: JarvisIntentTriageDeps) {}

  async triage(input: string, opts: { systemState?: string } = {}): Promise<JarvisTriageResult> {
    const started = Date.now();
    const state = opts.systemState ? `system state: ${opts.systemState}` : undefined;

    const [executable, category] = (await this.deps.backend.batch([
      {
        kind: "noul",
        question: `Is this a directly executable command rather than a conversational or open-ended request: "${input}"`,
        state,
      },
      {
        kind: "choice",
        question: `Which category best fits this request: "${input}"`,
        options: [...JARVIS_INTENT_CATEGORIES],
        state,
      },
    ])) as [NoulResult, ChoiceResult];

    const route: JarvisTriageResult["route"] =
      executable.probability >= EXECUTABLE_THRESHOLD &&
      category.confidence >= CATEGORY_CONFIDENCE_THRESHOLD &&
      category.selected !== "complex_reasoning_required"
        ? "local"
        : "system2";

    return {
      input,
      route,
      intentCategory: category.selected,
      executable,
      category,
      latencyMs: Date.now() - started,
    };
  }
}
