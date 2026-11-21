// A TEST STUB standing in for the language model. It only exercises the plumbing
// (prompt -> JSON -> validation). It is never used for the demo video.
function stubModel(messages) {
  const last = messages[messages.length - 1].content;
  const m = last.match(/CONTEXT:\n([\s\S]*?)\n\nCUSTOMER MESSAGE:\n([\s\S]*)$/);
  const lines = m ? m[1].split('\n').map((s) => s.replace(/^- /, '')) : [];
  const text = m ? m[2] : '';
  const facts = lines.filter((l) => !l.startsWith('Support hours'));
  let body;
  if (/^(hi|hello|hey)\b/i.test(text)) {
    body = { reply: 'Hello! How can I help you today?', intent: 'greeting', escalate: false, confidence: 0.95 };
  } else if (facts.length === 0) {
    body = { reply: 'I am not sure about that.', intent: 'other', escalate: true, confidence: 0.3 };
  } else {
    body = { reply: facts[0].slice(0, 160), intent: facts[0].startsWith('ORDER') ? 'order_status' : 'product_info', escalate: false, confidence: 0.9 };
  }
  return { choices: [{ message: { content: JSON.stringify(body) } }] };
}
module.exports = { stubModel };
