// Normalize: accept a WhatsApp Cloud API webhook payload OR the simple web-chat payload.
const item = $input.first().json;
let body = item.body !== undefined ? item.body : item;
if (typeof body === 'string') {
  try { body = JSON.parse(body); } catch (e) { body = { text: body }; }
}

const wa = body && body.entry && body.entry[0] && body.entry[0].changes && body.entry[0].changes[0]
  ? body.entry[0].changes[0].value
  : null;

let from, name, text, messageId, source;
if (wa && wa.messages && wa.messages.length) {
  const m = wa.messages[0];
  source = 'whatsapp';
  from = m.from;
  messageId = m.id;
  name = (wa.contacts && wa.contacts[0] && wa.contacts[0].profile && wa.contacts[0].profile.name) || 'Customer';
  text = m.type === 'text' && m.text ? m.text.body : '';
} else {
  source = 'web';
  from = body.from || 'web-demo';
  name = body.name || 'Demo customer';
  text = body.text || body.message || '';
  messageId = body.id || `web-${Date.now()}`;
}

text = String(text || '').trim().slice(0, 1000);

return [{
  json: {
    phone: String(from),
    name: String(name),
    text,
    message_id: String(messageId),
    empty: text.length === 0,
    source,
  },
}];
