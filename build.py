#!/usr/bin/env python3
"""Generate workflows/whatsapp-ai-support-agent.workflow.json from nodes/*.js and data/knowledge_base.json."""
import json, pathlib

root = pathlib.Path(__file__).parent
kb = json.loads((root / "data" / "knowledge_base.json").read_text(encoding="utf-8"))


def code(name):
    src = (root / "nodes" / name).read_text(encoding="utf-8")
    return src.replace("__KB__", json.dumps(kb, ensure_ascii=False, indent=2))


MONGO_CRED = {"mongoDb": {"id": "REPLACE_ME", "name": "MongoDB (n8n app user)"}}
GROQ_CRED = {"httpHeaderAuth": {"id": "REPLACE_ME", "name": "Groq API key"}}
WA_CRED = {"httpHeaderAuth": {"id": "REPLACE_ME", "name": "WhatsApp Cloud API token"}}


def node(nid, name, ntype, version, pos, params, **extra):
    n = {"parameters": params, "id": nid, "name": name, "type": ntype, "typeVersion": version, "position": pos}
    n.update(extra)
    return n


def if_node(nid, name, pos, left, right, op):
    return node(nid, name, "n8n-nodes-base.if", 2, pos, {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"},
            "conditions": [{"id": nid + "-c1", "leftValue": left, "rightValue": right, "operator": op}],
            "combinator": "and",
        },
        "options": {},
    })


llm_body = (
    "={{ JSON.stringify({ model: 'openai/gpt-oss-120b', temperature: 0.2, max_completion_tokens: 1500, reasoning_effort: 'low', "
    "response_format: { type: 'json_object' }, messages: $json.messages }) }}"
)
respond_body = (
    "={{ JSON.stringify({ reply: $json.reply, intent: $json.intent, escalated: $json.escalate, "
    "confidence: $json.confidence, sources: $json.kb_sources, route: $json.route }) }}"
)
wa_body = (
    "={{ JSON.stringify({ messaging_product: 'whatsapp', to: $json.phone, type: 'text', "
    "text: { body: $json.reply } }) }}"
)

nodes = [
    node("a1", "Customer message", "n8n-nodes-base.webhook", 2, [0, 300], {
        "httpMethod": "POST", "path": "support-agent", "responseMode": "responseNode",
        "options": {"allowedOrigins": "*"},
    }, webhookId="6f1d2a54-8c3e-4b7a-9d21-5a0c3e7b1f42"),
    node("a2", "Normalize", "n8n-nodes-base.code", 2, [260, 300], {"jsCode": code("normalize.js")}),
    node("a3", "Get history", "n8n-nodes-base.mongoDb", 1.2, [520, 300], {
        "operation": "find", "collection": "support_messages",
        "options": {"limit": 6, "sort": "{\"created_at\": -1}"},
        "query": "={{ JSON.stringify({ phone: $('Normalize').first().json.phone }) }}",
    }, alwaysOutputData=True, credentials=MONGO_CRED),
    node("a4", "Build context", "n8n-nodes-base.code", 2, [780, 300], {"jsCode": code("build_context.js")}),
    if_node("a5", "Use AI?", [1040, 300], "={{ $json.route }}", "llm",
            {"type": "string", "operation": "equals"}),
    node("a6", "Call LLM (Groq)", "n8n-nodes-base.httpRequest", 4.2, [1300, 200], {
        "method": "POST", "url": "https://api.groq.com/openai/v1/chat/completions",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendBody": True, "specifyBody": "json", "jsonBody": llm_body,
        "options": {"timeout": 30000},
    }, credentials=GROQ_CRED, retryOnFail=True, maxTries=2, waitBetweenTries=1500, onError="continueRegularOutput"),
    node("a7", "Parse reply", "n8n-nodes-base.code", 2, [1560, 200], {"jsCode": code("parse_reply.js")}),
    node("a8", "Rule reply", "n8n-nodes-base.code", 2, [1300, 420], {"jsCode": code("rule_reply.js")}),
    node("a9", "Respond to chat", "n8n-nodes-base.respondToWebhook", 1.1, [1820, 300], {
        "respondWith": "json", "responseBody": respond_body,
        "options": {"responseHeaders": {"entries": [{"name": "Access-Control-Allow-Origin", "value": "*"}]}},
    }),
    node("a10", "Log message", "n8n-nodes-base.mongoDb", 1.2, [2080, 300], {
        "operation": "insert", "collection": "support_messages",
        "fields": "phone,name,user_text,reply,intent,escalate,confidence,kb_sources,route,model,source,created_at",
        "options": {},
    }, credentials=MONGO_CRED),
    if_node("a11", "Needs a human?", [2340, 300], "={{ $('Respond to chat').first().json.escalate }}", "",
            {"type": "boolean", "operation": "true", "singleValue": True}),
    node("a12", "Make ticket", "n8n-nodes-base.code", 2, [2600, 220], {"jsCode": code("make_ticket.js")}),
    node("a13", "Create ticket", "n8n-nodes-base.mongoDb", 1.2, [2860, 220], {
        "operation": "insert", "collection": "support_tickets",
        "fields": "ticket_id,status,phone,name,user_text,bot_reply,intent,created_at",
        "options": {},
    }, credentials=MONGO_CRED),
    node("a14", "Send via WhatsApp Cloud API (disabled)", "n8n-nodes-base.httpRequest", 4.2, [2080, 520], {
        "method": "POST", "url": "https://graph.facebook.com/v21.0/YOUR_PHONE_NUMBER_ID/messages",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendBody": True, "specifyBody": "json", "jsonBody": wa_body, "options": {},
    }, credentials=WA_CRED, disabled=True, onError="continueRegularOutput"),
    node("a15", "Setup note", "n8n-nodes-base.stickyNote", 1, [-20, 40], {
        "content": ("## WhatsApp AI support agent\n"
                    "1. Add a **Header Auth** credential named *Groq API key*: name `Authorization`, value `Bearer <your key>`.\n"
                    "2. Add the MongoDB credential on the three Mongo nodes.\n"
                    "3. Send a POST to `/webhook/support-agent` (or use the chat simulator page).\n"
                    "Knowledge base lives inside the *Build context* node."),
        "height": 200, "width": 520,
    }),
]

def link(*targets):
    return {"main": [[{"node": t, "type": "main", "index": 0} for t in targets]]}

connections = {
    "Customer message": link("Normalize"),
    "Normalize": link("Get history"),
    "Get history": link("Build context"),
    "Build context": link("Use AI?"),
    "Use AI?": {"main": [
        [{"node": "Call LLM (Groq)", "type": "main", "index": 0}],
        [{"node": "Rule reply", "type": "main", "index": 0}],
    ]},
    "Call LLM (Groq)": link("Parse reply"),
    "Parse reply": link("Respond to chat"),
    "Rule reply": link("Respond to chat"),
    "Respond to chat": link("Log message", "Send via WhatsApp Cloud API (disabled)"),
    "Log message": link("Needs a human?"),
    "Needs a human?": {"main": [
        [{"node": "Make ticket", "type": "main", "index": 0}],
        [],
    ]},
    "Make ticket": link("Create ticket"),
}

workflow = {
    "name": "WhatsApp AI support agent",
    "nodes": nodes,
    "connections": connections,
    "active": False,
    "settings": {"executionOrder": "v1", "timezone": "Asia/Karachi"},
    "pinData": {},
    "meta": {"templateCredsSetupCompleted": False},
}

out = root / "workflows" / "whatsapp-ai-support-agent.workflow.json"
out.write_text(json.dumps(workflow, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("wrote", out, len(nodes), "nodes")
