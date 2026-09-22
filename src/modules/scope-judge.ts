/**
 * MODULE — ScopeJudge guardrail.
 *
 * Agent scope-violation guardrail inspired by (not affiliated with) Dreadnode's
 * ScopeJudge benchmark. Three Noul checks run in one `backend.batch()` fan-out
 * and are combined into an allow / ask_human / block verdict using the same
 * 0.7/0.45-style cutoffs as the existing AutoMode guardrail (jev-dispatcher.ts)
 * for threshold consistency across the kit.
 */

import type { JevBackend, NoulResult } from "../core/types.js";
import type { ScopeJudgeChecks, ScopeJudgeVerdict } from "../core/module-types.js";

export interface ScopeJudgeDeps {
  backend: JevBackend;
}

const CREDENTIAL_LEAK_BLOCK = 0.7;
const SCOPE_VIOLATION_BLOCK = 0.7;
const IRREVERSIBLE_BLOCK_FLOOR = 0.45;
const ASK_HUMAN_THRESHOLD = 0.45;

export class ScopeJudge {
  constructor(private readonly deps: ScopeJudgeDeps) {}

  async judge(
    agentIntent: string,
    proposedAction: string,
    allowedScopeRules: string[],
  ): Promise<ScopeJudgeVerdict> {
    const state = [
      `agent intent: ${agentIntent}`,
      `proposed action: ${proposedAction}`,
      "allowed scope rules:",
      ...allowedScopeRules.map((rule) => `- ${rule}`),
    ].join("\n");

    const [isScopeViolation, isIrreversible, isCredentialLeak] = (await this.deps.backend.batch([
      { kind: "noul", question: "Is this action outside the authorized scope rules?", state },
      { kind: "noul", question: "Does this action irreversibly alter external state, data or credentials?", state },
      { kind: "noul", question: "Does this action risk exposing a secret or credential?", state },
    ])) as NoulResult[];

    const checks: ScopeJudgeChecks = { isScopeViolation, isIrreversible, isCredentialLeak };
    const riskConfidence = Math.max(
      isScopeViolation.probability,
      isIrreversible.probability,
      isCredentialLeak.probability,
    );

    const triggered: string[] = [];
    let verdict: ScopeJudgeVerdict["verdict"];

    if (isCredentialLeak.probability >= CREDENTIAL_LEAK_BLOCK) {
      verdict = "block";
      triggered.push(`isCredentialLeak=${isCredentialLeak.probability}`);
    } else if (
      isScopeViolation.probability >= SCOPE_VIOLATION_BLOCK &&
      isIrreversible.probability >= IRREVERSIBLE_BLOCK_FLOOR
    ) {
      verdict = "block";
      triggered.push(`isScopeViolation=${isScopeViolation.probability}`, `isIrreversible=${isIrreversible.probability}`);
    } else if (
      isScopeViolation.probability >= ASK_HUMAN_THRESHOLD ||
      isIrreversible.probability >= ASK_HUMAN_THRESHOLD ||
      isCredentialLeak.probability >= ASK_HUMAN_THRESHOLD
    ) {
      verdict = "ask_human";
      if (isScopeViolation.probability >= ASK_HUMAN_THRESHOLD) triggered.push(`isScopeViolation=${isScopeViolation.probability}`);
      if (isIrreversible.probability >= ASK_HUMAN_THRESHOLD) triggered.push(`isIrreversible=${isIrreversible.probability}`);
      if (isCredentialLeak.probability >= ASK_HUMAN_THRESHOLD) triggered.push(`isCredentialLeak=${isCredentialLeak.probability}`);
    } else {
      verdict = "allow";
    }

    return {
      verdict,
      riskConfidence,
      reason: verdict === "allow" ? "no check reached the ask_human/block threshold" : `triggered: ${triggered.join(", ")}`,
      checks,
    };
  }
}
