/**
 * MODULE 9 — Chief of Staff Dispatcher & AutoMode Guardrail.
 *
 * The dispatcher reads shared memory + task intent and routes work to the best
 * next agent role via the Choice primitive. The guardrail is the safety gate
 * that every dangerous tool call passes through before execution.
 */

import { loadMemory, recentFailures } from "../core/memory.js";
import type { JevBackend } from "../core/types.js";
import type { AgentRole, DispatchDecision, GuardrailVerdict } from "../core/module-types.js";

export interface DispatcherDeps {
  backend: JevBackend;
  memoryPath?: string;
  concurrency?: number;
}

export const ROLE_CATALOG: Array<{ role: AgentRole; mission: string; tools: string[] }> = [
  { role: "researcher", mission: "gather external evidence, sources and prior art", tools: ["jev_research", "jev_github_mine"] },
  { role: "planner", mission: "turn intent into a steeled, risk-scored plan", tools: ["jev_plan", "jev_redteam"] },
  { role: "implementer", mission: "write or modify code with verifiable tests", tools: ["jev_guardrail", "jev_verify"] },
  { role: "reviewer", mission: "attack the implementation, find races and blind spots", tools: ["jev_redteam", "jev_audit"] },
  { role: "writer", mission: "produce docs, launch copy and stakeholder updates", tools: ["jev_research", "jev_evaluate"] },
  { role: "auditor", mission: "scan the system across the 5 audit dimensions", tools: ["jev_audit", "jev_memory"] },
];

interface DangerRule {
  name: string;
  re: RegExp;
  action: "block" | "ask";
  reason: string;
}

const DANGER_RULES: DangerRule[] = [
  { name: "recursive-root-delete", re: /rm\s+-rf\s+(?:\/|~|\$HOME|[A-Za-z]:\\?)(?:\s|$)/i, action: "block", reason: "recursive delete of a root/home path" },
  { name: "format-or-diskpart", re: /\b(?:format\s+[a-z]:|diskpart|mkfs|fdisk)\b/i, action: "block", reason: "disk formatting/partition operation" },
  { name: "fork-bomb", re: /:\(\)\{.*\};:/, action: "block", reason: "fork bomb" },
  { name: "curl-pipe-shell", re: /\b(?:curl|wget)\b[^|]*\|\s*(?:ba|z|k)?sh\b/i, action: "block", reason: "piping remote content into a shell" },
  { name: "sql-destructive", re: /\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i, action: "block", reason: "destructive SQL statement" },
  { name: "windows-force-delete", re: /Remove-Item[^|;]*-Recurse[^|;]*-Force[^|;]*(?:[A-Za-z]:\\|\$env:USERPROFILE|\$HOME)/i, action: "block", reason: "recursive forced delete outside the project" },
  { name: "shutdown", re: /\b(?:shutdown|reboot|halt|poweroff)\b/i, action: "block", reason: "host shutdown" },
  { name: "force-push", re: /git\s+push[^\n]*--force|git\s+push\s+-f\b/i, action: "ask", reason: "force push rewrites remote history" },
  { name: "hard-reset", re: /git\s+reset\s+--hard/i, action: "ask", reason: "hard reset discards uncommitted work" },
  { name: "publish", re: /\b(?:npm|yarn|pnpm)\s+publish\b/i, action: "ask", reason: "publishing a package is irreversible" },
  { name: "global-install", re: /\b(?:npm|pip)\s+(?:install|i)\s+(?:-g|--global|--user)\b/i, action: "ask", reason: "machine-wide installation" },
  { name: "sudo", re: /\bsudo\b|\bRunAs\s+Administrator\b/i, action: "ask", reason: "privilege escalation" },
  { name: "delete-command", re: /(?:^|[\s;&|])(?:rm|del|Remove-Item)\s+/i, action: "ask", reason: "file deletion" },
  { name: "env-exfil", re: /\bcat\b[^\n]*\.env|Get-Content[^\n]*\.env|printenv\b/i, action: "ask", reason: "reading environment secrets" },
  { name: "cluster-mutation", re: /\bkubectl\s+(?:delete|apply|drain)\b|\bterraform\s+(?:apply|destroy)\b/i, action: "ask", reason: "infrastructure mutation" },
];

export class ChiefOfStaff {
  constructor(private readonly deps: DispatcherDeps) {}

  /** Pick the next agent role from task intent + shared memory. */
  async dispatch(task: string, opts: { context?: string[] } = {}): Promise<DispatchDecision> {
    const memory = loadMemory(this.deps.memoryPath);
    const failures = recentFailures(memory, 3);
    const state = [
      `task: ${task}`,
      ...ROLE_CATALOG.map((r) => `role: ${r.role} -> ${r.mission}`),
      `policy: execute>${memory.policy.executeThreshold} escalate<${memory.policy.escalateThreshold}`,
      `reward: ${memory.stats.reward}`,
      ...failures.map((f) => `prior-failure: ${f.slice(0, 140)}`),
      ...(opts.context ?? []).slice(0, 20).map((c) => `context: ${c}`),
    ].join("\n");

    const choice = await this.deps.backend.choice({
      kind: "choice",
      question: `Which agent role should act next for this task: ${task}`,
      options: ROLE_CATALOG.map((r) => r.role),
      state,
    });

    const selected = ROLE_CATALOG[choice.selectedIndex] ?? ROLE_CATALOG[0]!;
    return {
      task,
      roleChoice: choice,
      role: selected.role,
      handoff: {
        to: selected.role,
        payload: {
          task,
          context: [
            `confidence=${choice.confidence}`,
            `mission=${selected.mission}`,
            ...(opts.context ?? []).slice(0, 10),
          ],
          requiredTools: selected.tools,
        },
      },
      nextSteps: [
        `hand off to ${selected.role} with the payload above`,
        choice.confidence < memory.policy.escalateThreshold
          ? "confidence is low: confirm with a human or run jev_plan first"
          : "confidence is high: proceed without an LLM round trip",
      ],
    };
  }

  /** AutoMode Guardrail: rule-based blacklist + Jev danger/severity scoring. */
  async guardrail(tool: string, args: string): Promise<GuardrailVerdict> {
    const haystack = `${tool} ${args}`;
    const matched = DANGER_RULES.filter((rule) => rule.re.test(haystack));
    const blocking = matched.filter((r) => r.action === "block");
    const asking = matched.filter((r) => r.action === "ask");

    const state = [
      `tool: ${tool}`,
      `args: ${args.slice(0, 600)}`,
      ...matched.map((r) => `rule: ${r.name} (${r.reason})`),
    ].join("\n");

    const [danger, severity] = await Promise.all([
      this.deps.backend.noul({
        kind: "noul",
        question: `Is executing this tool call dangerous, destructive or irreversible? ${tool}`,
        state,
      }),
      this.deps.backend.score({
        kind: "score",
        question: `Severity of the worst plausible outcome if this call executes unguarded: ${tool}`,
        min: 1,
        max: 10,
        state,
      }),
    ]);

    let decision: GuardrailVerdict["decision"];
    let reason: string;
    if (blocking.length > 0) {
      decision = "block";
      reason = `blocked by rule(s): ${blocking.map((r) => `${r.name} (${r.reason})`).join(", ")}`;
    } else if (danger.probability >= 0.7 || asking.length > 0) {
      decision = "ask";
      reason =
        `requires explicit approval: danger=${danger.probability}` +
        (asking.length ? `, rules: ${asking.map((r) => r.name).join(", ")}` : "");
    } else if (danger.probability >= 0.45) {
      decision = "ask";
      reason = `moderate danger (${danger.probability}) without a matching rule; confirm before running`;
    } else {
      decision = "allow";
      reason = `no dangerous rule matched and danger=${danger.probability} is below the approval threshold`;
    }

    return {
      tool,
      args,
      decision,
      danger,
      severity,
      matchedRules: matched.map((r) => r.name),
      reason,
    };
  }

  /** Convenience: guardrail boolean for tight tool loops. */
  async allowed(tool: string, args: string): Promise<boolean> {
    const verdict = await this.guardrail(tool, args);
    return verdict.decision === "allow";
  }
}
