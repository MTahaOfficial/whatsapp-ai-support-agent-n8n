// Parse reply: validate the model output. Anything malformed or low-confidence is handed to a human.
const ctx = $('Build context').first().json;
const res = $input.first().json;
const MODEL = 'openai/gpt-oss-120b';
const INTENTS = ['greeting', 'product_info', 'order_status', 'shipping', 'returns', 'warranty', 'payment', 'hours', 'discount', 'other'];

let out = null;
let error = null;
try {
  const content = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
  if (!content) throw new Error((res && res.error && (res.error.message || res.error)) || 'empty model response');
  out = JSON.parse(content);
} catch (e) {
  error = String(e.message || e).slice(0, 200);
}

let reply;
let intent = 'other';
let escalate = false;
let confidence = 0;

if (out && typeof out.reply === 'string' && out.reply.trim()) {
  reply = out.reply.trim().slice(0, 700);
  intent = INTENTS.includes(out.intent) ? out.intent : 'other';
  confidence = Number(out.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.max(0, Math.min(1, confidence));
  escalate = out.escalate === true || confidence < 0.6;
  if (escalate && !/teammate|team member|colleague/i.test(reply)) {
    reply += ' I have also passed this to a teammate to double-check.';
  }
} else {
  reply = 'Sorry, I am having trouble answering right now. I have passed your message to a teammate who will reply during support hours.';
  escalate = true;
}

return [{
  json: {
    phone: ctx.phone,
    name: ctx.name,
    user_text: ctx.text,
    reply,
    intent,
    escalate,
    confidence,
    kb_sources: ctx.kb_sources,
    route: 'llm',
    model: MODEL,
    source: ctx.source,
    error,
    created_at: new Date().toISOString(),
  },
}];
