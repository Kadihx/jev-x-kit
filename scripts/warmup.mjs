// Warmup: load the model into GPU and verify JSON mode works.
const response = await fetch("http://localhost:11434/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model: "qwen2.5:3b",
    messages: [{ role: "user", content: 'Reply with exactly {"ok":true} and nothing else.' }],
    max_tokens: 30,
    temperature: 0,
    response_format: { type: "json_object" },
  }),
});
const payload = await response.json();
console.log("warmup status:", response.status);
console.log("warmup content:", payload.choices?.[0]?.message?.content);
