// Local emulation of the n8n workflow: runs the SAME Code-node files, in the same order,
// with an in-memory stand-in for MongoDB. The model call is injected (stub in tests).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const KB = fs.readFileSync(path.join(root, 'data', 'knowledge_base.json'), 'utf8');

function runCode(file, input, nodes) {
  const src = fs.readFileSync(path.join(root, 'nodes', file), 'utf8').replace('__KB__', KB);
  const $ = (name) => {
    if (!nodes[name]) throw new Error(`node "${name}" has no output`);
    return { first: () => nodes[name][0], all: () => nodes[name] };
  };
  const $input = { first: () => input[0], all: () => input };
  return new Function('$input', '$', src)($input, $);
}

function makePipeline(callModel) {
  const db = { support_messages: [], support_tickets: [] };
  const stats = { llmCalls: 0 };

  async function handle(body) {
    const nodes = {};
    nodes['Customer message'] = [{ json: { body } }];
    nodes['Normalize'] = runCode('normalize.js', nodes['Customer message'], nodes);
    const phone = nodes['Normalize'][0].json.phone;

    const hist = db.support_messages
      .filter((d) => d.phone === phone)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 6);
    nodes['Get history'] = hist.length ? hist.map((d) => ({ json: d })) : [{ json: {} }]; // alwaysOutputData

    nodes['Build context'] = runCode('build_context.js', nodes['Get history'], nodes);
    const ctx = nodes['Build context'][0].json;

    let out;
    if (ctx.route === 'llm') {
      stats.llmCalls += 1;
      let res;
      try { res = await callModel(ctx.messages); } catch (e) { res = { error: String(e.message || e) }; } // onError: continue
      nodes['Call LLM (Groq)'] = [{ json: res }];
      out = runCode('parse_reply.js', nodes['Call LLM (Groq)'], nodes);
    } else {
      out = runCode('rule_reply.js', nodes['Build context'], nodes);
    }
    nodes['Respond to chat'] = out;
    const r = out[0].json;
    db.support_messages.push({ ...r }); // Log message
    let ticket = null;
    if (r.escalate === true) {
      nodes['Make ticket'] = runCode('make_ticket.js', out, nodes);
      ticket = nodes['Make ticket'][0].json;
      db.support_tickets.push(ticket); // Create ticket
    }
    return {
      response: { reply: r.reply, intent: r.intent, escalated: r.escalate, confidence: r.confidence, sources: r.kb_sources, route: r.route },
      ctx, logged: r, ticket,
    };
  }
  return { handle, db, stats };
}

module.exports = { makePipeline, runCode };
