/**
 * PhoneBridge-AgentHub Backend Server
 * Main entry point - Express + WebSocket + SQLite
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Import routes
const sessionRoutes = require('./routes/session');
const chatRoutes = require('./routes/chat');
const approveRoutes = require('./routes/approve');
const diffRoutes = require('./routes/diff');

// Import services
const SessionStore = require('./services/SessionStore');
const EventBus = require('./services/EventBus');
const AntigravityBridge = require('./services/AntigravityBridge');
const ConversationWatcher = require('./services/ConversationWatcher');
const messageLogger = require('./services/MessageLogger');
const AcceptDetector = require('./services/accept-detector');

// Configuration
const PORT = process.env.PORT || 8000;
const FRONTEND_PATH = path.join(__dirname, '..', 'frontend');
const DATA_DIR = path.join(__dirname, '..', 'Data');
const TEXT_DIR = path.join(DATA_DIR, 'Text');
const IMAGE_DIR = path.join(DATA_DIR, 'image');

const ensureDir = (dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });

// Initialize services
const sessionStore = new SessionStore();
const eventBus = new EventBus(wss);
const antigravityBridge = new AntigravityBridge(eventBus);
const conversationWatcher = new ConversationWatcher(eventBus);
const acceptDetector = new AcceptDetector(eventBus);

// Make services available to routes
app.locals.sessionStore = sessionStore;
app.locals.eventBus = eventBus;
app.locals.antigravityBridge = antigravityBridge;
app.locals.conversationWatcher = conversationWatcher;
app.locals.acceptDetector = acceptDetector;

// Middleware
app.use(cors());
app.use(express.json({ limit: '20gb' })); // Large limit for video/file upload
app.use(express.urlencoded({ limit: '20gb', extended: true }));
app.use(express.static(FRONTEND_PATH));

// Serve uploaded images
ensureDir(TEXT_DIR);
ensureDir(IMAGE_DIR);
const UPLOADS_PATH = IMAGE_DIR;
app.use('/uploads', express.static(UPLOADS_PATH));

// API Routes
app.use('/api/session', sessionRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/approve', approveRoutes);
app.use('/api/diff', diffRoutes);
app.use('/api/screenshot', require('./routes/screenshot'));
app.use('/api/restart', require('./routes/restart'));
app.use('/api/shutdown', require('./routes/shutdown'));
app.use('/api/response', require('./routes/response'));
app.use('/api/debug', require('./routes/debug'));
app.use('/api/snapshot', require('./routes/snapshot'));
app.use('/api/extension', require('./routes/extension'));
app.use('/api/actions', require('./routes/actions')(antigravityBridge));
app.use('/api/inject', require('./routes/inject'));

// Message history settings
app.get('/api/settings/messages', (req, res) => {
    res.json({ max_messages: messageLogger.getMaxMessages() });
});

app.post('/api/settings/messages', (req, res) => {
    const { max_messages } = req.body || {};
    const updated = messageLogger.setMaxMessages(max_messages);
    if (!updated) {
        return res.status(400).json({ error: 'Invalid max_messages' });
    }
    return res.json({ success: true, max_messages: updated });
});

// Clear messages + images
app.post('/api/clear-messages', (req, res) => {
    try {
        messageLogger.clearHistory();
        sessionStore.clearMessages();

        let deletedImages = 0;
        if (fs.existsSync(IMAGE_DIR)) {
            const files = fs.readdirSync(IMAGE_DIR);
            files.forEach((file) => {
                const filePath = path.join(IMAGE_DIR, file);
                try {
                    if (fs.statSync(filePath).isFile()) {
                        fs.unlinkSync(filePath);
                        deletedImages += 1;
                    }
                } catch (err) {
                    // Ignore delete failures
                }
            });
        }

        return res.json({ success: true, deleted_images: deletedImages });
    } catch (err) {
        console.error('Failed to clear messages:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        sessions: sessionStore.count()
    });
});

// Upload image endpoint (from mobile app)
app.post('/api/upload-image', (req, res) => {
    try {
        const { image, format } = req.body;

        if (!image) {
            return res.status(400).json({ error: 'No image data' });
        }

        // Create image directory if not exists
        ensureDir(IMAGE_DIR);

        // Generate filename with timestamp
        const filename = `mobile_${Date.now()}.${format || 'jpg'}`;
        const filePath = path.join(IMAGE_DIR, filename);
        const fullPath = path.resolve(filePath);

        // Decode base64 and save
        const buffer = Buffer.from(image, 'base64');
        fs.writeFileSync(filePath, buffer);

        console.log(`📷 Image uploaded: ${filename} (${buffer.length} bytes)`);

        res.json({
            success: true,
            filename: filename,
            path: `uploads/${filename}`,
            fullPath: fullPath,
            size: buffer.length
        });
    } catch (err) {
        console.error('❌ Upload error:', err);
        res.status(500).json({ error: err.message });
    }
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    const urlPath = req.url || '';

    // ===== HANDLE ACTION BRIDGE CONNECTION (from detect_actions.js) =====
    if (urlPath === '/ws/action-bridge') {
        console.log('🎯 WebSocket: Action Bridge connected (detect_actions.js)');
        ws.isActionBridge = true;

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                console.log(`🎯 Action Bridge: Received [${message.type}]`);

                if (message.type === 'action_detector_register') {
                    ws.send(JSON.stringify({ type: 'action_detector_registered', status: 'ok' }));
                    app.locals.actionBridgeWs = ws;

                    // ✅ NEW: Set WebSocket in AcceptDetector for Accept/Reject commands
                    acceptDetector.setBridgeWs(ws);
                    console.log('✅ Action Bridge WebSocket registered with AcceptDetector');
                    return;
                }

                // Forward action events to AcceptDetector
                acceptDetector.handleBridgeMessage(message);

            } catch (err) {
                console.error('❌ Action Bridge error:', err.message);
            }
        });

        ws.on('close', () => {
            console.log('👋 Action Bridge disconnected');
            app.locals.actionBridgeWs = null;

            // ✅ NEW: Clear WebSocket in AcceptDetector
            acceptDetector.clearBridgeWs();
        });

        return;
    }

    // ===== HANDLE EXTENSION CONNECTION (from AntiBridge Extension) =====
    if (urlPath === '/ws/extension') {
        console.log('🔌 WebSocket: AntiBridge Extension connected!');
        ws.isExtension = true;
        app.locals.extensionWs = ws;

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                console.log(`📩 Extension: Received [${message.type}]`);

                if (message.type === 'extension_connect') {
                    console.log(`✅ Extension registered: ${message.client} v${message.version}`);
                    ws.send(JSON.stringify({ type: 'extension_registered', status: 'ok' }));
                    return;
                }

                if (message.type === 'chat_sent') {
                    console.log(`✅ Extension confirmed: Chat sent via ${message.method}`);
                    return;
                }

                if (message.type === 'action_result') {
                    console.log(`✅ Extension: ${message.action} = ${message.success}`);
                    // Broadcast result to all mobile clients
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN && !client.isExtension && !client.isBridge) {
                            client.send(JSON.stringify({
                                type: 'action_feedback',
                                action: message.action,
                                success: message.success
                            }));
                        }
                    });
                    return;
                }

                if (message.type === 'pong') {
                    return; // Ignore pong responses
                }

            } catch (err) {
                console.error('❌ Extension message error:', err.message);
            }
        });

        ws.on('close', () => {
            console.log('👋 AntiBridge Extension disconnected');
            app.locals.extensionWs = null;
        });

        return;
    }

    // ===== HANDLE BRIDGE CONNECTION (from Antigravity console script) =====
    if (urlPath === '/ws/bridge') {
        console.log('🌉 WebSocket: Bridge client connected (Antigravity console)');

        ws.isBridge = true;

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());

                if (message.type === 'bridge_register') {
                    console.log('✅ Bridge registered from:', message.source);
                    ws.send(JSON.stringify({ type: 'bridge_registered', status: 'ok' }));

                    // Lưu bridgeWs để chat.js có thể gửi inject_message
                    app.locals.bridgeWs = ws;
                    console.log('📌 Bridge WebSocket saved to app.locals.bridgeWs');
                    return;
                }

                if (message.type === 'ai_messages' && message.messages) {
                    console.log(`📨 Bridge: Received ${message.messages.length} AI messages`);

                    // Separate streaming vs complete messages
                    const streamingMsgs = message.messages.filter(m => m.isStreaming);
                    const completeMsgs = message.messages.filter(m => m.isComplete);

                    // Forward to ALL connected mobile clients
                    wss.clients.forEach((client) => {
                        if (client !== ws && client.readyState === WebSocket.OPEN && !client.isBridge) {
                            // Send streaming updates
                            if (streamingMsgs.length > 0) {
                                client.send(JSON.stringify({
                                    type: 'chat_update',
                                    data: {
                                        messages: streamingMsgs.map(m => ({
                                            role: m.role || 'assistant',
                                            text: m.text,
                                            html: m.html,
                                            format: m.html ? 'html' : 'text',
                                            timestamp: m.timestamp
                                        })),
                                        partial: true,
                                        source: 'bridge'
                                    },
                                    ts: new Date().toISOString()
                                }));
                            }

                            // Send complete messages
                            completeMsgs.forEach(m => {
                                client.send(JSON.stringify({
                                    type: 'chat_complete',
                                    data: {
                                        content: m.text,
                                        html: m.html,
                                        format: m.html ? 'html' : 'text',
                                        role: m.role || 'assistant',
                                        timestamp: m.timestamp,
                                        source: 'bridge'
                                    },
                                    ts: new Date().toISOString()
                                }));
                            });
                        }
                    });

                    // 📝 LOG TIN NHẮN GỬI TỚI ĐIỆN THOẠI
                    if (streamingMsgs.length > 0) {
                        messageLogger.logStreaming(streamingMsgs);
                    }
                    completeMsgs.forEach(m => messageLogger.logComplete(m));

                    console.log(`✅ Forwarded: streaming=${streamingMsgs.length}, complete=${completeMsgs.length}, htmlLen=${completeMsgs[0]?.html?.length || 0}`);
                }
            } catch (err) {
                console.error('❌ Bridge message error:', err.message);
            }
        });

        ws.on('close', () => {
            console.log('👋 Bridge client disconnected');
        });

        return;
    }

    // ===== HANDLE REGULAR SESSION CONNECTION =====
    // Extract session_id from URL: /ws/{session_id}
    const match = urlPath.match(/^\/ws\/([a-zA-Z0-9_-]+)$/);

    if (!match) {
        console.log('❌ WebSocket: Invalid connection URL:', urlPath);
        ws.close(4000, 'Invalid session URL');
        return;
    }

    const sessionId = match[1];
    console.log(`🔌 WebSocket: Client connected to session ${sessionId}`);

    // Register client with EventBus
    eventBus.addClient(sessionId, ws);

    // Send welcome message
    eventBus.emit(sessionId, 'status', {
        message: 'Connected to PhoneBridge-AgentHub',
        session_id: sessionId
    });

    // ===== SYNC HISTORY =====
    // Gửi lịch sử chat gần nhất cho client mới kết nối
    try {
        const history = messageLogger.getRecentHistory();
        if (history.length > 0) {
            console.log(`📂 Sending ${history.length} history messages to client`);
            history.forEach(msg => {
                ws.send(JSON.stringify({
                    type: 'chat_complete',
                    data: {
                        content: msg.text,
                        html: msg.html,
                        format: msg.format || 'text',
                        role: msg.role,
                        timestamp: msg.timestamp,
                        source: 'history'
                    }
                }));
            });
        }
    } catch (err) {
        console.error('❌ Error sending history:', err.message);
    }

    // ===== AUTO-START CHAT POLLING =====
    // Khi client kết nối, tự động connect CDP và start polling
    (async () => {
        try {
            const connected = await antigravityBridge.connect();
            if (connected) {
                console.log(`🚀 Auto-starting chat polling for session ${sessionId}`);
                antigravityBridge.startChatPolling(sessionId);
            } else {
                console.log(`⚠️ CDP not available, chat polling not started`);
                eventBus.emit(sessionId, 'status', {
                    message: 'Warning: CDP not connected. AI responses may not be received.',
                    type: 'warning'
                });
            }
        } catch (err) {
            console.error('❌ Auto-start chat polling error:', err.message);
        }
    })();

    // Handle incoming messages
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());

            // Handle ping/pong for keepalive
            if (message.type === 'ping') {
                ws.send('pong');
                // console.log(`🏓 Pong sent to session ${sessionId}`);
                return;
            }

            console.log(`📨 WebSocket: Received from ${sessionId} [${message.type}]:`, message);

            // Handle Send Message from Mobile App
            if (message.type === 'send_message' && message.text) {
                console.log(`💬 User sent message: "${message.text}"`);

                // 1. Save to History (User role)
                messageLogger.saveHistory('user', message.text, null);

                // 2. Broadcast to ALL clients (SYNC DEVICES)
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN && !client.isBridge) {
                        client.send(JSON.stringify({
                            type: 'chat_complete',
                            data: {
                                content: message.text,
                                role: 'user',
                                timestamp: new Date().toISOString(),
                                source: 'sync'
                            }
                        }));
                    }
                });

                // 3. Inject to Antigravity - TRY EXTENSION FIRST, fallback to CDP
                (async () => {
                    ws.send(JSON.stringify({ type: 'status', message: '🚀 Sending message...', level: 'info' }));

                    // Check if Extension is connected
                    const extensionWs = app.locals.extensionWs;

                    // 🔍 DEBUG: Log extension status
                    console.log('🔍 DEBUG Extension Status:');
                    console.log('   - extensionWs exists:', !!extensionWs);
                    console.log('   - readyState:', extensionWs?.readyState);
                    console.log('   - WebSocket.OPEN:', WebSocket.OPEN);
                    console.log('   - Is OPEN:', extensionWs?.readyState === WebSocket.OPEN);

                    if (extensionWs && extensionWs.readyState === WebSocket.OPEN) {
                        // ✅ Use Extension (VS Code Commands API)
                        console.log('📤 Sending via Extension (VS Code Commands API)');
                        extensionWs.send(JSON.stringify({
                            type: 'send_message',  // ← FIX: Đổi từ 'send_chat' sang 'send_message'
                            text: message.text
                        }));
                        ws.send(JSON.stringify({ type: 'status', message: '✅ Sent via Extension!', level: 'success' }));
                    } else {
                        // ⚠️ Fallback to CDP
                        console.log('⚠️ Extension not connected (extensionWs=' + !!extensionWs + ', readyState=' + extensionWs?.readyState + ')');
                        console.log('⚠️ Trying CDP fallback...');
                        const sent = await antigravityBridge.sendMessage('default-user-session', message.text);

                        if (sent) {
                            ws.send(JSON.stringify({ type: 'status', message: '✅ Sent via CDP!', level: 'success' }));
                        } else {
                            ws.send(JSON.stringify({ type: 'status', message: '❌ Failed: No Extension or CDP', level: 'error' }));
                        }
                    }
                })();
            }
        } catch (err) {
            console.error('❌ WebSocket: Invalid message format:', err.message);
        }
    });

    // Handle disconnect
    ws.on('close', () => {
        console.log(`👋 WebSocket: Client disconnected from session ${sessionId}`);
        eventBus.removeClient(sessionId, ws);
    });

    // Handle errors
    ws.on('error', (err) => {
        console.error(`❌ WebSocket error for session ${sessionId}:`, err.message);
    });
});


// Start server - bind to all interfaces (0.0.0.0)
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║          PhoneBridge-AgentHub Backend Server               ║
╠════════════════════════════════════════════════════════════╣
║  🌐 REST API:    http://localhost:${PORT}                    ║
║  🔌 WebSocket:   ws://localhost:${PORT}/ws/{session_id}      ║
║  📁 Frontend:    http://localhost:${PORT}                    ║
╚════════════════════════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down server...');
    await acceptDetector.stop();
    sessionStore.close();
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

module.exports = { app, server, wss };
