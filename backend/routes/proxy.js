const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// Mock list of models
router.get('/v1/models', (req, res) => {
    res.json({
        object: "list",
        data: [
            { id: "gpt-4", object: "model", created: 1677610602, owned_by: "openai" },
            { id: "gpt-3.5-turbo", object: "model", created: 1677610602, owned_by: "openai" },
            { id: "gemini-pro", object: "model", created: 1700000000, owned_by: "google" }
        ]
    });
});

// Chat Completions
router.post('/v1/chat/completions', async (req, res) => {
    const { messages, model, stream } = req.body;
    const sessionStore = req.app.locals.sessionStore;
    const antigravityBridge = req.app.locals.antigravityBridge;
    const messageLogger = require('../services/MessageLogger');

    console.log(`🔌 API Proxy: Request for model [${model}]`);

    // 1. Create temporary session
    const sessionId = 'api-' + uuidv4();
    sessionStore.createSession(sessionId, 'api-client');

    // 2. Map model if needed (Simple mapping logic)
    // If user sends "gpt-4", we switch Antigravity to "GPT-4" or best match
    if (model) {
        await antigravityBridge.changeModel(model);
    }

    // 3. Extract last user message
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user') {
        return res.status(400).json({ error: "Last message must be from user" });
    }

    // 4. Send to Antigravity via CDP
    const sent = await antigravityBridge.sendMessage(sessionId, lastMsg.content);
    if (!sent) {
        return res.status(503).json({ error: "Antigravity not connected" });
    }

    // 5. Handle Streaming or Non-Streaming
    // Note: Implementing true streaming response requires hooking into WebSocket events 
    // and piping them to HTTP response. This is complex for this quick implementation.
    // For now, we will wait for completion (non-streaming) or partial simulation.

    // CURRENT LIMITATION: We only support Non-Streaming for this quick MVP.
    // We need to wait for the "Bridge" to send back the response.

    // Setup a listener for the response
    const eventBus = req.app.locals.eventBus;

    // Timeout 60s
    let responded = false;
    const timeout = setTimeout(() => {
        if (!responded) {
            responded = true;
            eventBus.off(sessionId, listener);
            res.status(504).json({ error: "Timeout waiting for Antigravity response" });
        }
    }, 60000);

    const listener = (type, data) => {
        if (type === 'chat_complete') {
            if (!responded) {
                responded = true;
                clearTimeout(timeout);

                // Return OpenAI format
                res.json({
                    id: "chatcmpl-" + uuidv4(),
                    object: "chat.completion",
                    created: Math.floor(Date.now() / 1000),
                    model: model || "antigravity-model",
                    choices: [{
                        index: 0,
                        message: {
                            role: "assistant",
                            content: data.content || data.html // Prefer text content
                        },
                        finish_reason: "stop"
                    }],
                    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
                });

                // Cleanup
                eventBus.off(sessionId, listener);
            }
        }
    };

    // Antigravity Bridge sends 'chat_complete' via EventBus when it receives data
    eventBus.on(sessionId, listener);
});

module.exports = router;
