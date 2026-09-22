#!/usr/bin/env python3
"""Real local LayA benchmark: same 10-question battery as backend-benchmark.mjs.

LayA is a separate project (https://github.com/NandhaKishorM/laya /
https://huggingface.co/convaiinnovations/laya), not part of jev-x-kit's own
Node/TS runtime -- this script is optional investigative tooling, kept out of
the kit's own dependencies. It needs its own Python env because laya pulls in
torch + transformers.

Setup (once):
    python -m venv .laya-venv
    .laya-venv/Scripts/python.exe -m pip install laya   # ~800MB model on first run

Run:
    # Windows without Developer Mode / admin: huggingface_hub's default cache
    # uses symlinks, which needs SeCreateSymbolicLinkPrivilege. Disable them:
    HF_HUB_DISABLE_SYMLINKS=1 .laya-venv/Scripts/python.exe scripts/laya-benchmark.py

Writes artifacts/laya-benchmark-report.md and prints the same JSON to stdout.
"""
import json
import time
from pathlib import Path

t0 = time.time()
import laya
import torch

agent = laya.load("convaiinnovations/laya")
load_s = time.time() - t0
gpu = torch.cuda.is_available()

state = "general knowledge and engineering judgment battery"

# Same 10 questions as scripts/backend-benchmark.mjs's BATTERY, adapted to
# LayA's {type, instructions, criteria} shape (criteria is a dict of
# option->description for choice, a list of ordinal labels for score, and
# omitted for noul -- matching how typesafe-native.ts adapts to its own API).
QUESTIONS = {
    "q1": {"type": "choice", "instructions": "What is the capital of France?",
           "criteria": {"Paris": "Paris", "Berlin": "Berlin", "London": "London", "Madrid": "Madrid"}},
    "q2": {"type": "choice", "instructions": "Which of these numbers is prime?",
           "criteria": {"4": "4", "6": "6", "7": "7", "9": "9"}},
    "q3": {"type": "choice", "instructions": "Which planet is closest to the sun?",
           "criteria": {"Mercury": "Mercury", "Venus": "Venus", "Earth": "Earth", "Mars": "Mars"}},
    "q4": {"type": "choice", "instructions": "In HTTP, which status code means 'not found'?",
           "criteria": {"200": "200", "301": "301", "404": "404", "500": "500"}},
    "q5": {"type": "choice", "instructions": "Which storage fits an offline-first, single-user MCP agent? (zero infra budget, must work with no network)",
           "criteria": {"postgres cluster": "postgres cluster", "sqlite": "sqlite", "hosted mongo": "hosted mongo"}},
    "q6": {"type": "score", "instructions": "How maintainable is a module with 95% test coverage and typed boundaries? (tests passing, typed, atomic writes, reviewed)",
           "criteria": [str(i) for i in range(1, 11)]},
    "q7": {"type": "score", "instructions": "Severity of the worst plausible outcome if this tool call executes unguarded. (tool: bash, args: rm -rf /)",
           "criteria": [str(i) for i in range(1, 11)]},
    "q8": {"type": "score", "instructions": "Clarity of this ad copy on a 1-10 scale. (ad copy: Last chance: 50% off ends tonight!)",
           "criteria": [str(i) for i in range(1, 11)]},
    "q9": {"type": "noul", "instructions": "Will this change cause a regression in production? (covered by tests, atomic writes, deterministic, reviewed)"},
    "q10": {"type": "noul", "instructions": "Does this action irreversibly alter external state, data or credentials? (action: read a public status page)"},
}
EXPECTED_CHOICE = {"q1": "Paris", "q2": "7", "q3": "Mercury", "q4": "404"}


def main() -> None:
    t1 = time.time()
    result = agent.predict(state, QUESTIONS)
    batch_ms = (time.time() - t1) * 1000
    answers = result["answers"]
    correct = sum(1 for k, v in EXPECTED_CHOICE.items() if answers.get(k, {}).get("choice") == v)

    summary = {
        "device": "cuda" if gpu else "cpu",
        "load_seconds": round(load_s, 2),
        "batch_ms_for_10_questions": round(batch_ms, 2),
        "avg_ms_per_question": round(batch_ms / len(QUESTIONS), 2),
        "correct_out_of_4_factual": correct,
        "answers": answers,
    }
    print(json.dumps(summary, indent=2, default=str))

    root = Path(__file__).resolve().parent.parent
    lines = [
        "# LayA local benchmark",
        "",
        f"Generated: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}",
        "",
        f"Device: **{summary['device']}**"
        + (
            ""
            if gpu
            else " -- no CUDA GPU detected on this machine. LayA's own docs claim ~33-38ms/question on GPU; "
            "these numbers are CPU-bound and not representative of GPU performance."
        ),
        f"Model load (one-time, includes ~800MB HF download on first run): {summary['load_seconds']}s",
        f"Batch inference, same 10-question battery as backend-benchmark.mjs, ONE forward pass: "
        f"{summary['batch_ms_for_10_questions']}ms total, {summary['avg_ms_per_question']}ms/question average.",
        f"Correctness on the 4 factual choice questions (capital of France, prime number, closest planet, "
        f"HTTP 404): **{correct}/4** correct.",
        "",
        "Compare against `artifacts/backend-benchmark-report.md`'s batch() row for typesafe_jev "
        "(real hosted API, same battery): typesafe_jev was both faster (~82ms/question batched) and more "
        "accurate than this CPU-bound local LayA run. LayA's own model card lists its strengths as English "
        "text classification / guardrails / email triage, not open-domain trivia, so this specific battery "
        "plays to typesafe_jev's strengths, not LayA's -- a fair LayA benchmark would use a triage/classification "
        "task and, ideally, a GPU.",
        "",
        "## Raw answers",
        "",
        "```json",
        json.dumps(answers, indent=2, default=str),
        "```",
    ]
    out_file = root / "artifacts" / "laya-benchmark-report.md"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nWritten to {out_file}")


if __name__ == "__main__":
    main()
