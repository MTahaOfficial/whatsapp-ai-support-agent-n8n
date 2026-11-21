const assert = require('assert');
const { makePipeline } = require('./pipeline');
const { stubModel } = require('./stub_model');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log('  ok   ' + name); }
  catch (e) { failures.push(name); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
const msg = (text, from = '923001112233') => ({ from, name: 'Test', text });

(async () => {
  console.log('routing and retrieval');
  await test('greeting goes to the model and is not escalated', async () => {
    const p = makePipeline(async (m) => stubModel(m));
    const r = await p.handle(msg('hi there'));
    assert.strictEqual(r.ctx.route, 'llm');
    assert.strictEqual(r.response.intent, 'greeting');
    assert.strictEqual(r.response.escalated, false);
  });
  await test('product question retrieves the right product (out-of-stock item)', async () => {
    const p = makePipeline(async (m) => stubModel(m));
    const r = await p.handle(msg('Do you have the hand grinder mini?'));
    assert.ok(r.response.sources.includes('BG-102'), 'sources: ' + r.response.sources);
    const prompt = r.ctx.messages[r.ctx.messages.length - 1].content;
    assert.ok(/OUT OF STOCK/.test(prompt));
  });
  await test('order number is looked up and put in the prompt', async () => {
    const p = makePipeline(async (m) => stubModel(m));
    const r = await p.handle(msg('where is ORD-1002?'));
    assert.ok(r.response.sources.includes('ORD-1002'));
    assert.ok(/TCS-77421903/.test(r.ctx.messages[r.ctx.messages.length - 1].content));
  });
  await test('unknown order number is flagged as not found', async () => {
    const p = makePipeline(async (m) => stubModel(m));
    const r = await p.handle(msg('status of ord-9999'));
    assert.ok(r.response.sources.includes('order-not-found'));
  });
  await test('order question with no number asks for it', async () => {
    const p = makePipeline(async (m) => stubModel(m));
    const r = await p.handle(msg('where is my order'));
    assert.ok(/gave no order number/.test(r.ctx.messages[r.ctx.messages.length - 1].content));
  });
  await test('follow-up reuses the order number from earlier in the chat', async () => {
    const p = makePipeline(async (m) => stubModel(m));
    await p.handle(msg('check ORD-1003 please'));
    const r = await p.handle(msg('when will my order ship?'));
    assert.ok(r.response.sources.includes('ORD-1003'), 'sources: ' + r.response.sources);
  });
  await test('follow-up "when will it arrive?" reuses the order from the previous turn', async () => {
    const p = makePipeline(async (m) => stubModel(m));
    await p.handle(msg('Where is my order ORD-1002?'));
    const r = await p.handle(msg('And when will it arrive?'));
    assert.ok(r.response.sources.includes('ORD-1002'), 'sources: ' + r.response.sources);
  });
  await test('history is passed to the model, per customer only', async () => {
    const p = makePipeline(async (m) => stubModel(m));
    await p.handle(msg('hi', 'A'));
    await p.handle(msg('hi', 'B'));
    const r = await p.handle(msg('how much is shipping?', 'A'));
    const roles = r.ctx.messages.map((x) => x.role);
    assert.deepStrictEqual(roles, ['system', 'user', 'assistant', 'user']);
  });

  console.log('hand-over rules');
  await test('explicit human request skips the model and opens a ticket', async () => {
    const p = makePipeline(async (m) => stubModel(m));
    const r = await p.handle(msg('I want to speak to a human'));
    assert.strictEqual(r.ctx.route, 'human');
    assert.strictEqual(p.stats.llmCalls, 0);
    assert.strictEqual(r.response.escalated, true);
    assert.strictEqual(p.db.support_tickets.length, 1);
    assert.strictEqual(r.ticket.status, 'open');
  });
  await test('angry/legal wording is handed over without the model', async () => {
    const p = makePipeline(async (m) => stubModel(m));
    const r = await p.handle(msg('This is a scam, I will call my lawyer'));
    assert.strictEqual(r.ctx.route, 'human');
    assert.strictEqual(p.stats.llmCalls, 0);
  });
  await test('a non-text message gets a canned reply and no ticket', async () => {
    const p = makePipeline(async (m) => stubModel(m));
    const payload = { entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Ayesha' } }], messages: [{ from: '923331234567', id: 'wamid.X', type: 'image' }] } }] }] };
    const r = await p.handle(payload);
    assert.strictEqual(r.ctx.route, 'empty');
    assert.strictEqual(p.stats.llmCalls, 0);
    assert.strictEqual(p.db.support_tickets.length, 0);
    assert.strictEqual(r.ctx.source, 'whatsapp');
  });
  await test('question the knowledge base cannot answer is escalated', async () => {
    const p = makePipeline(async (m) => stubModel(m));
    const r = await p.handle(msg('Can you recommend a good dentist?'));
    assert.strictEqual(r.response.escalated, true);
    assert.ok(/teammate/i.test(r.response.reply));
    assert.strictEqual(p.db.support_tickets.length, 1);
  });

  console.log('input formats');
  await test('WhatsApp Cloud API text payload is parsed', async () => {
    const p = makePipeline(async (m) => stubModel(m));
    const payload = { entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Ayesha' } }], messages: [{ from: '923331234567', id: 'wamid.ABC', type: 'text', text: { body: 'hello' } }] } }] }] };
    const r = await p.handle(payload);
    assert.strictEqual(r.logged.phone, '923331234567');
    assert.strictEqual(r.logged.name, 'Ayesha');
    assert.strictEqual(r.logged.source, 'whatsapp');
  });
  await test('JSON sent as a text/plain string body is parsed (browser simple request)', async () => {
    const p = makePipeline(async (m) => stubModel(m));
    const r = await p.handle(JSON.stringify({ from: 'web-1', name: 'Web', text: 'hello' }));
    assert.strictEqual(r.logged.phone, 'web-1');
    assert.strictEqual(r.logged.user_text, 'hello');
  });
  await test('very long messages are cut to 1000 characters', async () => {
    const p = makePipeline(async (m) => stubModel(m));
    const r = await p.handle(msg('x'.repeat(5000)));
    assert.strictEqual(r.logged.user_text.length, 1000);
  });

  console.log('model failure handling');
  await test('network/API error falls back to a human hand-over', async () => {
    const p = makePipeline(async () => { throw new Error('429 rate limit'); });
    const r = await p.handle(msg('how much is shipping?'));
    assert.strictEqual(r.response.escalated, true);
    assert.ok(/teammate/i.test(r.response.reply));
    assert.ok(/429/.test(r.logged.error));
    assert.strictEqual(p.db.support_tickets.length, 1);
  });
  await test('model returning non-JSON falls back', async () => {
    const p = makePipeline(async () => ({ choices: [{ message: { content: 'Sure! Shipping is free.' } }] }));
    const r = await p.handle(msg('how much is shipping?'));
    assert.strictEqual(r.response.escalated, true);
    assert.ok(r.logged.error);
  });
  await test('JSON with an unknown intent is coerced to "other"', async () => {
    const p = makePipeline(async () => ({ choices: [{ message: { content: JSON.stringify({ reply: 'Shipping is $6.', intent: 'made_up', escalate: false, confidence: 0.9 }) } }] }));
    const r = await p.handle(msg('shipping cost?'));
    assert.strictEqual(r.response.intent, 'other');
    assert.strictEqual(r.response.escalated, false);
  });
  await test('low confidence is escalated even if the model said it is fine', async () => {
    const p = makePipeline(async () => ({ choices: [{ message: { content: JSON.stringify({ reply: 'Maybe 3 days.', intent: 'shipping', escalate: false, confidence: 0.4 }) } }] }));
    const r = await p.handle(msg('shipping time?'));
    assert.strictEqual(r.response.escalated, true);
    assert.ok(/teammate/i.test(r.response.reply));
  });
  await test('confidence outside 0..1 is clamped', async () => {
    const p = makePipeline(async () => ({ choices: [{ message: { content: JSON.stringify({ reply: 'Shipping is $6.', intent: 'shipping', escalate: false, confidence: 7 }) } }] }));
    const r = await p.handle(msg('shipping cost?'));
    assert.strictEqual(r.response.confidence, 1);
  });
  await test('empty model content (e.g. error body) falls back with the API message', async () => {
    const p = makePipeline(async () => ({ error: { message: 'invalid_api_key' } }));
    const r = await p.handle(msg('hello'));
    assert.strictEqual(r.response.escalated, true);
    assert.ok(/invalid_api_key/.test(r.logged.error));
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
