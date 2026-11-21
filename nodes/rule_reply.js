// Rule reply: no model call. Used for explicit human requests and non-text messages.
const ctx = $input.first().json;

let reply;
let intent;
let escalate;
if (ctx.route === 'human') {
  reply = 'Of course. I have asked a teammate to take over this chat. They will reply during support hours (Monday to Saturday, 9:00 to 18:00 Pakistan time).';
  intent = 'human_request';
  escalate = true;
} else {
  reply = 'I can only read text messages at the moment. Could you type your question?';
  intent = 'other';
  escalate = false;
}

return [{
  json: {
    phone: ctx.phone,
    name: ctx.name,
    user_text: ctx.text || '[non-text message]',
    reply,
    intent,
    escalate,
    confidence: 1,
    kb_sources: [],
    route: ctx.route,
    model: 'rules',
    source: ctx.source,
    error: null,
    created_at: new Date().toISOString(),
  },
}];
