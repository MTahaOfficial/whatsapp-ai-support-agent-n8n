// Make ticket: one open ticket per handed-over message, for the support team to pick up.
const r = $('Respond to chat').first().json;
return [{
  json: {
    ticket_id: `T-${Date.now()}`,
    status: 'open',
    phone: r.phone,
    name: r.name,
    user_text: r.user_text,
    bot_reply: r.reply,
    intent: r.intent,
    created_at: new Date().toISOString(),
  },
}];
