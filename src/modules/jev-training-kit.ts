/**
 * MODULE 7 — Jev Training, Labeling & SLM Distillation Kit.
 *
 * Auto-labels raw datasets with the Jev primitives ($0 on local/heuristic
 * backends), generates RLCD/DPO preference pairs for local models, and emits a
 * concrete distillation recipe (axolotl/unsloth + vLLM) for Qwen2.5-0.5B or a
 * ModernBERT-421M decision head.
 */

import { artifactsDir, writeLinesAtomic } from "../core/paths.js";
import { round } from "../core/text.js";
import type { ChoiceResult, JevBackend, NoulResult, ScoreResult } from "../core/types.js";
import type { DatasetLabel, DistillRecipe, PreferencePair } from "../core/module-types.js";

export interface TrainingDeps {
  backend: JevBackend;
  concurrency?: number;
}

export interface LabelOptions {
  mode?: "choice" | "score" | "noul";
  question?: string;
  options?: string[];
  /** Write the labeled JSONL into artifacts/datasets (default true). */
  writeFile?: boolean;
}

export interface LabeledDataset {
  labels: DatasetLabel[];
  file: string | null;
  rows: number;
  costUsd: number;
  msPerRow: number;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export class JevTrainingKit {
  constructor(private readonly deps: TrainingDeps) {}

  /** Auto-dataset labeler: one fan-out pass over all rows. */
  async label(rows: string[], opts: LabelOptions = {}): Promise<LabeledDataset> {
    const started = Date.now();
    const mode = opts.mode ?? "choice";
    const question = opts.question ?? "Which label best fits this sample?";
    const options = opts.options ?? ["good", "bad", "unknown"];

    const results = await this.deps.backend.batch(
      rows.map((row, i) => {
        if (mode === "choice") {
          return { kind: "choice" as const, id: `row-${i + 1}`, question, options, state: `sample: ${row}` };
        }
        if (mode === "score") {
          return { kind: "score" as const, id: `row-${i + 1}`, question: `${question} (1-10)`, state: `sample: ${row}` };
        }
        return { kind: "noul" as const, id: `row-${i + 1}`, question, state: `sample: ${row}` };
      }),
    );

    const labels: DatasetLabel[] = rows.map((row, i) => {
      const result = results[i]!;
      const base = { input: row, backend: result.backend, costUsd: result.usage.costUsd };
      if (result.kind === "choice") {
        const choice = result as ChoiceResult;
        return { ...base, label: { kind: "choice", value: choice.selected, confidence: choice.confidence } };
      }
      if (result.kind === "score") {
        return { ...base, label: { kind: "score", value: (result as ScoreResult).score } };
      }
      return { ...base, label: { kind: "noul", value: (result as NoulResult).probability } };
    });

    let file: string | null = null;
    if (opts.writeFile !== false) {
      file = `${artifactsDir("datasets")}/labeled-${mode}-${timestamp()}.jsonl`;
      writeLinesAtomic(file, labels.map((l) => JSON.stringify(l)));
    }

    const costUsd = round(labels.reduce((sum, l) => sum + l.costUsd, 0), 8);
    const msPerRow = rows.length > 0 ? round((Date.now() - started) / rows.length, 3) : 0;
    return { labels, file, rows: rows.length, costUsd, msPerRow };
  }


  /** RLCD / DPO preference pairs: score every candidate, keep best vs worst. */
  async preferencePairs(
    items: Array<{ prompt: string; candidates: string[] }>,
    opts: { writeFile?: boolean } = {},
  ): Promise<{ pairs: PreferencePair[]; file: string | null }> {
    const flat: Array<{ promptIndex: number; prompt: string; candidate: string }> = [];
    items.forEach((item, promptIndex) =>
      item.candidates.forEach((candidate) => flat.push({ promptIndex, prompt: item.prompt, candidate })),
    );

    const results = (await this.deps.backend.batch(
      flat.map((row) => ({
        kind: "score" as const,
        question: "Quality of this candidate response for the prompt (1-10)",
        state: `prompt: ${row.prompt}\ncandidate: ${row.candidate}`,
      })),
    )) as ScoreResult[];

    const pairs: PreferencePair[] = [];
    items.forEach((item, promptIndex) => {
      const scored = flat
        .map((row, i) => ({ ...row, score: results[i]?.score ?? 5 }))
        .filter((row) => row.promptIndex === promptIndex)
        .sort((a, b) => b.score - a.score);
      if (scored.length < 2) return;
      const best = scored[0]!;
      const worst = scored[scored.length - 1]!;
      if (best.score === worst.score) return;
      pairs.push({
        prompt: item.prompt,
        chosen: best.candidate,
        rejected: worst.candidate,
        chosenScore: best.score,
        rejectedScore: worst.score,
        rationale: `RLCD: chose score ${best.score} over ${worst.score}`,
      });
    });

    let file: string | null = null;
    if (opts.writeFile !== false) {
      file = `${artifactsDir("datasets")}/preference-pairs-${timestamp()}.jsonl`;
      writeLinesAtomic(file, pairs.map((p) => JSON.stringify(p)));
    }
    return { pairs, file };
  }

  /** Distillation recipe + ready-to-train axolotl YAML for the target model. */
  distillRecipe(
    target: "qwen2.5-0.5b" | "modernbert-421m" | "custom" = "qwen2.5-0.5b",
    datasetFile = "artifacts/datasets/labeled-choice.jsonl",
  ): DistillRecipe {
    if (target === "modernbert-421m") {
      return {
        target,
        method: "lora",
        lora: { r: 8, alpha: 16, dropout: 0.05, targetModules: ["Wqkv", "Wo"] },
        hyperparameters: { epochs: 3, lr: 0.0003, batchSize: 32, maxSeqLen: 512, warmupRatio: 0.06 },
        datasetFormat: "jsonl-chat",
        commands: [
          "pip install 'transformers>=4.46' 'datasets>=3' 'peft>=0.13' accelerate",
          `python scripts/train_head.py --base answerdotai/ModernBERT-base --data ${datasetFile} --out artifacts/models/jev-modernbert-head`,
          "python -m laya.serve --port 8000  # serve the tuned head through the LayA runtime",
        ],
        notes: [
          "421M decision head over a frozen encoder: classification/regression head, CPU-class latency.",
          "Train on the labeled JSONL produced by jev_label_dataset; keep a 10% holdout for calibration.",
          "Export to ONNX/CoreML for Neural-Engine free inference.",
        ],
      };
    }
    return {
      target,
      method: "lora",
      lora: { r: 16, alpha: 32, dropout: 0.05, targetModules: ["q_proj", "k_proj", "v_proj", "o_proj"] },
      hyperparameters: { epochs: 2, lr: 0.0002, batchSize: 8, maxSeqLen: 1024, warmupRatio: 0.03 },
      datasetFormat: "jsonl-dpo",
      commands: [
        "pip install axolotl  # or: pip install unsloth",
        "axolotl train artifacts/training/qwen-jev.yml  # generated by jev_distill_recipe",
        "python -m vllm.entrypoints.openai.api_server --model artifacts/models/jev-qwen-merged --port 8000",
        'export OPENJEV_BASE_URL="http://localhost:8000/v1"  # the kit now serves from your distilled model',
      ],
      notes: [
        "Qwen2.5-0.5B class student: distills Choice/Score/Noul behavior for 100% offline, millisecond-class decisions.",
        "Use preference pairs from jev_preference_pairs for the DPO stage; label-only data for the SFT stage.",
        "After training, point JEV_BACKEND_PROVIDER=openjev_local at the served model.",
      ],
    };
  }

  /** Axolotl YAML for the Qwen LoRA stage (written on demand). */
  buildAxolotlYaml(datasetFile = "artifacts/datasets/preference-pairs.jsonl"): string {
    return [
      "base_model: Qwen/Qwen2.5-0.5B-Instruct",
      "trust_remote_code: false",
      "load_in_4bit: false",
      "adapter: lora",
      "lora_r: 16",
      "lora_alpha: 32",
      "lora_dropout: 0.05",
      "lora_target_modules:",
      "  - q_proj",
      "  - k_proj",
      "  - v_proj",
      "  - o_proj",
      "datasets:",
      `  - path: ${datasetFile}`,
      "    type: chat_template.default",
      "sequence_len: 1024",
      "micro_batch_size: 8",
      "gradient_accumulation_steps: 4",
      "num_epochs: 2",
      "learning_rate: 0.0002",
      "warmup_ratio: 0.03",
      "output_dir: artifacts/models/jev-qwen-lora",
      "logging_steps: 10",
      "save_strategy: epoch",
      "",
    ].join("\n");
  }
}
