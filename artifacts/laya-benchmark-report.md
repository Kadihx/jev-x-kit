# LayA local benchmark

Generated: 2026-09-22T13:07:37Z

Device: **cpu** -- no CUDA GPU detected on this machine. LayA's own docs claim ~33-38ms/question on GPU; these numbers are CPU-bound and not representative of GPU performance.
Model load (one-time, includes ~800MB HF download on first run): 31.69s
Batch inference, same 10-question battery as backend-benchmark.mjs, ONE forward pass: 1839.45ms total, 183.94ms/question average.
Correctness on the 4 factual choice questions (capital of France, prime number, closest planet, HTTP 404): **2/4** correct.

Compare against `artifacts/backend-benchmark-report.md`'s batch() row for typesafe_jev (real hosted API, same battery): typesafe_jev was both faster (~82ms/question batched) and more accurate than this CPU-bound local LayA run. LayA's own model card lists its strengths as English text classification / guardrails / email triage, not open-domain trivia, so this specific battery plays to typesafe_jev's strengths, not LayA's -- a fair LayA benchmark would use a triage/classification task and, ideally, a GPU.

## Raw answers

```json
{
  "q1": {
    "type": "choice",
    "choice": "Paris",
    "probabilities": {
      "Paris": 0.6024,
      "Berlin": 0.1282,
      "London": 0.0601,
      "Madrid": 0.2094
    },
    "confidence": 0.2318,
    "action": {
      "act_probability": 1.0
    }
  },
  "q2": {
    "type": "choice",
    "choice": "4",
    "probabilities": {
      "4": 0.3299,
      "6": 0.2507,
      "7": 0.2406,
      "9": 0.1788
    },
    "confidence": 0.0166,
    "action": {
      "act_probability": 1.0
    }
  },
  "q3": {
    "type": "choice",
    "choice": "Mars",
    "probabilities": {
      "Mercury": 0.0438,
      "Venus": 0.0651,
      "Earth": 0.0778,
      "Mars": 0.8133
    },
    "confidence": 0.5083,
    "action": {
      "act_probability": 1.0
    }
  },
  "q4": {
    "type": "choice",
    "choice": "404",
    "probabilities": {
      "200": 0.1877,
      "301": 0.1535,
      "404": 0.469,
      "500": 0.1897
    },
    "confidence": 0.0823,
    "action": {
      "act_probability": 1.0
    }
  },
  "q5": {
    "type": "choice",
    "choice": "hosted mongo",
    "probabilities": {
      "postgres cluster": 0.1718,
      "sqlite": 0.1374,
      "hosted mongo": 0.6908
    },
    "confidence": 0.2437,
    "action": {
      "act_probability": 1.0
    }
  },
  "q6": {
    "type": "score",
    "score": 3.993,
    "legend": {
      "0": "1",
      "1": "2",
      "2": "3",
      "3": "4",
      "4": "5",
      "5": "6",
      "6": "7",
      "7": "8",
      "8": "9",
      "9": "10"
    },
    "probabilities": {
      "0": 0.0766,
      "1": 0.1882,
      "2": 0.1245,
      "3": 0.1184,
      "4": 0.0643,
      "5": 0.076,
      "6": 0.1005,
      "7": 0.1055,
      "8": 0.092,
      "9": 0.0539
    },
    "confidence": 0.0268,
    "action": {
      "act_probability": 1.0
    }
  },
  "q7": {
    "type": "score",
    "score": 2.0702,
    "legend": {
      "0": "1",
      "1": "2",
      "2": "3",
      "3": "4",
      "4": "5",
      "5": "6",
      "6": "7",
      "7": "8",
      "8": "9",
      "9": "10"
    },
    "probabilities": {
      "0": 0.4976,
      "1": 0.1234,
      "2": 0.0761,
      "3": 0.0591,
      "4": 0.0291,
      "5": 0.0266,
      "6": 0.0532,
      "7": 0.0593,
      "8": 0.0465,
      "9": 0.029
    },
    "confidence": 0.2456,
    "action": {
      "act_probability": 1.0
    }
  },
  "q8": {
    "type": "score",
    "score": 3.8268,
    "legend": {
      "0": "1",
      "1": "2",
      "2": "3",
      "3": "4",
      "4": "5",
      "5": "6",
      "6": "7",
      "7": "8",
      "8": "9",
      "9": "10"
    },
    "probabilities": {
      "0": 0.1405,
      "1": 0.1579,
      "2": 0.1311,
      "3": 0.1032,
      "4": 0.0594,
      "5": 0.069,
      "6": 0.0816,
      "7": 0.0939,
      "8": 0.1026,
      "9": 0.0607
    },
    "confidence": 0.0226,
    "action": {
      "act_probability": 1.0
    }
  },
  "q9": {
    "type": "noul",
    "noul": 0.1072,
    "confidence": 0.8928,
    "action": {
      "act_probability": 1.0
    }
  },
  "q10": {
    "type": "noul",
    "noul": 0.1058,
    "confidence": 0.8942,
    "action": {
      "act_probability": 1.0
    }
  }
}
```