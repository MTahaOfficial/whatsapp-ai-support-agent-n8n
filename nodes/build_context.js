// Build context: find the most relevant knowledge-base entries, look up an order if the
// customer sent an order number, decide the route, and build the model messages.
const KB = __KB__;

const n = $('Normalize').first().json;
const history = $('Get history').all()
  .map((i) => i.json)
  .filter((d) => d && d.user_text && d.reply)
  .reverse(); // oldest first

const text = n.text;
const lower = text.toLowerCase();

// ---- route -----------------------------------------------------------------
const HUMAN = /\b(human|real person|live agent|an agent|manager|supervisor|complain\w*|lawyer|legal|sue|chargeback|scam|fraud)\b/i;
let route = 'llm';
if (n.empty) route = 'empty';
else if (HUMAN.test(text)) route = 'human';

// ---- retrieval (keyword scoring) --------------------------------------------
const words = new Set(lower.replace(/[^a-z0-9\- ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
function score(entry) {
  let s = 0;
  for (const k of entry.keywords || []) {
    if (lower.includes(k)) s += k.includes(' ') ? 3 : 2;
  }
  const nameWords = (entry.name || '').toLowerCase().split(/\s+/);
  for (const w of nameWords) if (w.length > 3 && words.has(w)) s += 1;
  return s;
}
const entries = [
  ...KB.faqs.map((f) => ({ id: f.id, text: f.text, keywords: f.keywords })),
  ...KB.products.map((p) => ({ id: p.sku, name: p.name, text: p.text, keywords: p.keywords })),
];
const hits = entries
  .map((e) => ({ e, s: score(e) }))
  .filter((x) => x.s > 0)
  .sort((a, b) => b.s - a.s)
  .slice(0, 4);

const contextLines = hits.map((h) => `- ${h.e.text}`);
const sources = hits.map((h) => h.e.id);

// ---- order lookup -------------------------------------------------------------
const orderIds = (text.match(/ORD-\d{4}/gi) || []).map((s) => s.toUpperCase());
// also remember an order id mentioned earlier in this conversation
const recent = history.map((h) => h.user_text).join(' ');
const earlier = (recent.match(/ORD-\d{4}/gi) || []).map((s) => s.toUpperCase());
const askedOrder = /\b(order|parcel|package|tracking|track|delivery|shipped)\b/i.test(text);
// a follow-up such as "when will it arrive?" reuses the order number from earlier in the chat
const followUp = earlier.length > 0 && /\b(arrive|arrival|arrives|eta|late|delayed|delay|status)\b/i.test(text);
const idsToCheck = orderIds.length ? orderIds : ((askedOrder || followUp) ? earlier.slice(-1) : []);
for (const id of idsToCheck) {
  const o = KB.orders.find((x) => x.id === id);
  if (o) {
    contextLines.push(`- ORDER ${o.id}: status ${o.status}. ${o.detail}`);
    sources.push(o.id);
  } else {
    contextLines.push(`- ORDER ${id}: no order with this number exists in our system.`);
    sources.push('order-not-found');
  }
}
if (askedOrder && idsToCheck.length === 0) {
  contextLines.push('- The customer asks about an order but gave no order number. Ask them for it (format ORD-1001).');
}

contextLines.push(`- Support hours: ${KB.store.hours}`);

// ---- prompt ------------------------------------------------------------------
const system = [
  `You are the WhatsApp support assistant for ${KB.store.name}, an online coffee equipment shop.`,
  'Answer ONLY with facts found in the CONTEXT block of the latest message.',
  'If the answer is not in the CONTEXT, say you are not sure and set "escalate" to true. Never invent prices, stock levels, order details, policies or discounts.',
  'Style: friendly, plain text, at most 3 short sentences, no markdown, at most one emoji.',
  'Escalate (set "escalate" to true) when the customer is upset, asks for something you cannot do (special discounts, changing an order), or the CONTEXT does not cover the question.',
  'Reply with ONLY a JSON object, no other text, in this shape:',
  '{"reply": string, "intent": one of ["greeting","product_info","order_status","shipping","returns","warranty","payment","hours","discount","other"], "escalate": boolean, "confidence": number between 0 and 1}',
].join('\n');

const messages = [{ role: 'system', content: system }];
for (const h of history.slice(-4)) {
  messages.push({ role: 'user', content: h.user_text });
  messages.push({ role: 'assistant', content: h.reply });
}
messages.push({
  role: 'user',
  content: `CONTEXT:\n${contextLines.join('\n')}\n\nCUSTOMER MESSAGE:\n${text}`,
});

return [{
  json: {
    phone: n.phone,
    name: n.name,
    text,
    message_id: n.message_id,
    source: n.source,
    route,
    messages,
    kb_sources: sources,
  },
}];
