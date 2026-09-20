/**
 * "BELKİ" Gatekeeper — module 1 routing layer.
 *
 *  confidence > executeThreshold          -> execute    (run code/tool, $0 LLM cost)
 *  escalateThreshold .. executeThreshold  -> speculative (split into sub-decisions)
 *  confidence < escalateThreshold         -> system2    (LLM cascade / human approval)
 */

import type {
  ChoiceRequest,
  ChoiceResult,
  GatekeeperDecision,
  GatekeeperPolicy,
  JevBackend,
} from "./types.js";
import { DEFAULT_GATEKEEPER_POLICY } from "./types.js";
import { round } from "./text.js";

export interface GateRequest extends ChoiceRequest {
  policy?: GatekeeperPolicy;
  /** Extra context lines injected verbatim into the evaluator (never summarized). */
  state?: string;
}

/** Decompose an uncertain decision into three independent sub-questions. */
export function speculate(question: string, selected: string): Array<{ question: string; options: string[] }> {
  const base = selected || question;
  return [
    {
      question: `Is "${base}" safe and reversible for the current decision: ${question}`,
      options: ["yes", "no", "unknown"],
    },
    {
      question: `Is "${base}" cheap enough to try now (time + tokens): ${question}`,
      options: ["yes", "no", "unknown"],
    },
    {
      question: `Is "${base}" supported by direct evidence in the current context: ${question}`,
      options: ["yes", "no", "unknown"],
    },
  ];
}

export function routeByConfidence(
  question: string,
  confidence: number,
  policy: GatekeeperPolicy = DEFAULT_GATEKEEPER_POLICY,
): GatekeeperDecision {
  const executeThreshold = policy.executeThreshold;
  const escalateThreshold = policy.escalateThreshold;

  if (confidence > executeThreshold) {
    return {
      question,
      route: "execute",
      confidence,
      policy,
      belki: false,
      reason: `confidence ${round(confidence, 3)} > ${executeThreshold} -> direct execution, no LLM call needed`,
    };
  }

  if (confidence >= escalateThreshold) {
    return {
      question,
      route: "speculative",
      confidence,
      policy,
      belki: false,
      reason: `confidence ${round(confidence, 3)} in [${escalateThreshold}, ${executeThreshold}] -> speculative escalation`,
    };
  }

  return {
    question,
    route: "system2",
    confidence,
    policy,
    belki: true,
    reason: `confidence ${round(confidence, 3)} < ${escalateThreshold} ("BELKİ") -> System 2 cascade required`,
    escalation: {
      target: "llm",
      payload:
        `Uncertain decision (confidence ${round(confidence, 3)}). Answer with a single option and a one-line justification.\n` +
        `Question: ${question}`,
    },
  };
}

export interface GateOutcome {
  decision: GatekeeperDecision;
  primary: ChoiceResult;
  subChoices: ChoiceResult[];
}

/** Evaluate a decision and route it through the gatekeeper in one pass. */
export async function evaluateWithGate(
  backend: JevBackend,
  request: GateRequest,
): Promise<GateOutcome> {
  const primary = await backend.choice(request);
  const decision = routeByConfidence(
    request.question,
    primary.confidence,
    request.policy ?? DEFAULT_GATEKEEPER_POLICY,
  );

  const subChoices: ChoiceResult[] = [];
  if (decision.route === "speculative") {
    const subs = speculate(request.question, primary.selected);
    decision.subDecisions = subs;
    subChoices.push(...(await backend.batch(subs.map((s) => ({ ...s, kind: "choice" as const }))) as ChoiceResult[]));
    const agree = subChoices.filter((c) => c.selected === "yes").length;
    decision.reason += `; sub-decisions agree=${agree}/${subChoices.length}`;
    // Committee verdict: promote or demote based on sub-decision agreement.
    if (agree === subChoices.length && subChoices.length > 0) decision.route = "execute";
    else if (agree === 0) {
      decision.route = "system2";
      decision.belki = true;
      decision.escalation = {
        target: "human",
        payload: `All speculative sub-checks were negative for "${primary.selected}". Confirm before proceeding: ${request.question}`,
      };
    }
  }

  return { decision, primary, subChoices };
}
