/**
 * Extension Routes
 * API endpoints cho Console Script / Extension communication
 * 
 * POST /api/extension/chat - Nhận AI messages từ script
 * POST /api/extension/heartbeat - Heartbeat/keepalive
 */

const express = require('express');
const router = express.Router();
const ChatLogger = require('../services/ChatLogger');

const chatLogger = new ChatLogger();

/**
 * POST /api/extension/chat
 * Nhận AI messages từ console script
 * Body: { session_id: "abc123", messages: [{text, timestamp, isAI}] }
 */
router.post('/chat', (req, res) => {
    try {
        const { session_id, messages } = req.body;

        if (!session_id || !messages || !Array.isArray(messages)) {
            return res.status(400).json({
                error: 'session_id and messages array are required'
            });
        }

        const eventBus = req.app.locals.eventBus;
        const sessionStore = req.app.locals.sessionStore;

        console.log(`📥 Extension: Received ${messages.length} messages for session ${session_id}`);

        // Process each message
        messages.forEach(msg => {
            const text = msg.text || '';

            // Log to file
            chatLogger.logMessage('assistant', text, {
                source: 'extension',
                session_id: session_id
            });

            // Store in session
            sessionStore.addMessage(session_id, 'assistant', text);

            // Emit via WebSocket to mobile
            eventBus.emit(session_id, 'chat_update', {
                role: 'assistant',
                content: text,
                timestamp: msg.timestamp || new Date().toISOString(),
                source: 'extension'
            });

            console.log(`📡 Emitted to session ${session_id}: "${text.substring(0, 50)}..."`);
        });

        res.json({ ok: true, received: messages.length });

    } catch (err) {
        console.error('❌ Extension chat error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/extension/heartbeat
 * Heartbeat để giữ connection alive và lấy active session
 */
router.post('/heartbeat', (req, res) => {
    try {
        const { session_id } = req.body;
        const sessionStore = req.app.locals.sessionStore;

        // Get or create session
        let activeSessionId = session_id || 'default';

        // If session doesn't exist, get first available or create default
        let session = sessionStore.getSession(activeSessionId);
        if (!session) {
            const allSessions = sessionStore.getAllSessions();
            if (allSessions.length > 0) {
                // Use the most recent session
                activeSessionId = allSessions[allSessions.length - 1].id;
            } else {
                // Create default session
                sessionStore.createSession(activeSessionId);
            }
        }

        console.log(`💓 Heartbeat from extension, session: ${activeSessionId}`);

        res.json({
            ok: true,
            session_id: activeSessionId,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('❌ Heartbeat error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/extension/status
 * Kiểm tra trạng thái server
 */
router.get('/status', (req, res) => {
    res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

module.exports = router;
