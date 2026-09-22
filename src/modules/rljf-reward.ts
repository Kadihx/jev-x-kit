/**
 * MODULE — RLJF Reward (Reinforcement Learning from Jev Feedback).
 *
 * Reward calculator compatible with TRL/GRPO-style training loops: every
 * (prompt, completion) pair is scored for helpfulness (Score) and toxicity
 * (Noul) in two flat batched fan-outs (never one call per completion), then
 * combined into a single scalar reward per cell.
 */

import path from "node:path";
import { artifactsDir, writeLinesAtomic } from "../core/paths.js";
import { round } from "../core/text.js";
import type { JevBackend, NoulResult, ScoreResult } from "../core/types.js";
import type { RljfRewardCell, RljfRewardReport } from "../core/module-types.js";

export interface RljfRewardDeps {
  backend: JevBackend;
}

const HELPFULNESS_QUESTION = "How helpful and correct is this completion for the given prompt?";
const TOXICITY_QUESTION = "Is this completion toxic, offensive or harmful?";

interface Cell {
  promptIndex: number;
  completionIndex: number;
  prompt: string;
  completion: string;
}

export class RljfReward {
  constructor(private readonly deps: RljfRewardDeps) {}

  async reward(
    prompts: string[],
    completions: string[][],
    opts: { emitScript?: boolean } = {},
  ): Promise<RljfRewardReport> {
    const started = Date.now();
    if (prompts.length !== completions.length) {
      throw new Error("prompts and completions must have the same length");
    }

    const cells: Cell[] = [];
    prompts.forEach((prompt, promptIndex) => {
      (completions[promptIndex] ?? []).forEach((completion, completionIndex) => {
        cells.push({ promptIndex, completionIndex, prompt, completion });
      });
    });

    const state = (cell: Cell): string => `prompt: ${cell.prompt}\ncompletion: ${cell.completion}`;

    // Two flat batches covering every (prompt, completion) pair — never one call per completion.
    const helpfulness = (await this.deps.backend.batch(
      cells.map((cell) => ({
        kind: "score" as const,
        question: HELPFULNESS_QUESTION,
        min: 1,
        max: 10,
        state: state(cell),
      })),
    )) as ScoreResult[];

    const toxicity = (await this.deps.backend.batch(
      cells.map((cell) => ({
        kind: "noul" as const,
        question: TOXICITY_QUESTION,
        state: state(cell),
      })),
    )) as NoulResult[];

    const rewards: number[][] = prompts.map((_, i) => new Array((completions[i] ?? []).length).fill(0));
    const cellsOut: RljfRewardCell[] = cells.map((cell, i) => {
      const h = helpfulness[i]!;
      const t = toxicity[i]!;
      const range = h.max - h.min || 1;
      const normalizedHelpfulness = round((h.score - h.min) / range, 4);
      const toxicityProbability = t.probability;
      const rewardValue = round(normalizedHelpfulness - toxicityProbability, 4);
      rewards[cell.promptIndex]![cell.completionIndex] = rewardValue;
      return {
        promptIndex: cell.promptIndex,
        completionIndex: cell.completionIndex,
        reward: rewardValue,
        normalizedHelpfulness,
        toxicityProbability,
        helpfulness: h,
        toxicity: t,
      };
    });

    const costUsd = round(
      [...helpfulness, ...toxicity].reduce((sum, r) => sum + r.usage.costUsd, 0),
      6,
    );

    let scriptFile: string | null = null;
    if (opts.emitScript) {
      scriptFile = path.join(artifactsDir(), "rljf_grpo.py");
      writeLinesAtomic(scriptFile, GRPO_SCRIPT.split("\n"));
    }

    return {
      backend: this.deps.backend.meta.id,
      rewards,
      cells: cellsOut,
      totalLatencyMs: Date.now() - started,
      costUsd,
      scriptFile,
    };
  }
}

const GRPO_SCRIPT = `#!/usr/bin/env python3
"""RLJF (Reinforcement Learning from Jev Feedback) reward function for TRL GRPO.

Calls the jev-x-kit MCP server's jev_rljf_reward tool over stdio for every
GRPO rollout group and returns the per-completion reward as a flat float
list -- the shape GRPOTrainer expects from a reward_funcs callable.

Prereqs:
    pip install trl transformers datasets accelerate mcp
    npm run build   # builds dist/index.js, the MCP server this script drives

Run:
    python artifacts/rljf_grpo.py
"""
import asyncio
import json
from typing import Dict, List

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from trl import GRPOConfig, GRPOTrainer
from datasets import Dataset

JEV_SERVER = StdioServerParameters(
    command="node",
    args=["dist/index.js"],
    env={"JEV_BACKEND_PROVIDER": "heuristic"},
)


async def _call_jev_rljf_reward(prompts: List[str], completions: List[List[str]]) -> List[List[float]]:
    async with stdio_client(JEV_SERVER) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(
                "jev_rljf_reward",
                arguments={"prompts": prompts, "completions": completions},
            )
            payload = json.loads(result.content[0].text)
            return payload["rewards"]


def rljf_reward_func(prompts: List[str], completions: List[str], **kwargs) -> List[float]:
    """TRL GRPOTrainer reward_funcs entry point.

    TRL hands this a flat list where each prompt repeats once per generation
    in its group; we re-batch that back into the [prompt][completion] shape
    jev_rljf_reward expects, call it once, then flatten the rewards back out
    in the exact order TRL gave us the completions.
    """
    order: List[str] = []
    by_prompt: Dict[str, List[str]] = {}
    for prompt, completion in zip(prompts, completions):
        if prompt not in by_prompt:
            by_prompt[prompt] = []
            order.append(prompt)
        by_prompt[prompt].append(completion)

    rewards_by_prompt = asyncio.run(_call_jev_rljf_reward(order, [by_prompt[p] for p in order]))
    reward_lookup = {prompt: list(rewards) for prompt, rewards in zip(order, rewards_by_prompt)}

    cursor: Dict[str, int] = {p: 0 for p in order}
    flat_rewards: List[float] = []
    for prompt in prompts:
        idx = cursor[prompt]
        flat_rewards.append(reward_lookup[prompt][idx])
        cursor[prompt] += 1
    return flat_rewards


def main() -> None:
    dataset = Dataset.from_dict(
        {"prompt": ["Explain what a gatekeeper confidence threshold is in one paragraph."]}
    )

    config = GRPOConfig(
        output_dir="artifacts/training/rljf-grpo",
        num_generations=4,
        per_device_train_batch_size=4,
        max_completion_length=256,
        learning_rate=1e-6,
    )

    trainer = GRPOTrainer(
        model="Qwen/Qwen2.5-0.5B-Instruct",
        reward_funcs=rljf_reward_func,
        args=config,
        train_dataset=dataset,
    )
    trainer.train()


if __name__ == "__main__":
    main()
`;
