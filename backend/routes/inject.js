/**
 * Inject Routes
 * API endpoints for injecting scripts into Antigravity via CDP
 * 
 * LUỒNG HOẠT ĐỘNG:
 * 1. User mở Antigravity với --remote-debugging-port=9000
 * 2. User chạy START_SERVER.bat -> Server start + gọi /api/inject/all
 * 3. API này inject cả chat_bridge_ws.js và detect_actions.js vào console Antigravity
 * 4. User chạy START_ACCEPT_DETECTOR.bat -> Chỉ gọi /api/actions/start
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

/**
 * POST /api/inject/chat-bridge
 * Inject chat_bridge_ws.js vào Antigravity console qua CDP
 */
router.post('/chat-bridge', async (req, res) => {
    try {
        const antigravityBridge = req.app.locals.antigravityBridge;

        if (!antigravityBridge) {
            return res.status(503).json({
                error: 'AntigravityBridge service not available'
            });
        }

        // Ensure connected to CDP
        const connected = await antigravityBridge.connect();
        if (!connected) {
            return res.status(503).json({
                error: 'Cannot connect to Antigravity CDP. Make sure Antigravity is running with --remote-debugging-port=9000'
            });
        }

        // Inject chat bridge script
        const result = await antigravityBridge.injectChatBridge();

        res.json({
            success: result,
            message: result ? 'chat_bridge_ws.js injected successfully' : 'Injection failed or already injected',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('❌ Error injecting chat bridge:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/inject/action-detector
 * Inject detect_actions.js vào Antigravity console qua CDP
 */
router.post('/action-detector', async (req, res) => {
    try {
        const antigravityBridge = req.app.locals.antigravityBridge;

        if (!antigravityBridge) {
            return res.status(503).json({
                error: 'AntigravityBridge service not available'
            });
        }

        // Ensure connected to CDP
        const connected = await antigravityBridge.connect();
        if (!connected) {
            return res.status(503).json({
                error: 'Cannot connect to Antigravity CDP'
            });
        }

        // Read detect_actions.js script
        const scriptPath = path.join(__dirname, '../../scripts/detect_actions.js');
        if (!fs.existsSync(scriptPath)) {
            return res.status(404).json({
                error: `Script not found: ${scriptPath}`
            });
        }

        const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
        console.log(`📜 Loaded detect_actions.js (${scriptContent.length} bytes)`);

        // Check if already injected
        const alreadyInjected = await antigravityBridge.page.evaluate(() => {
            return typeof window.__startActionDetector !== 'undefined';
        });

        if (alreadyInjected) {
            console.log('ℹ️ detect_actions.js already injected');
            return res.json({
                success: true,
                message: 'detect_actions.js already injected',
                alreadyInjected: true,
                timestamp: new Date().toISOString()
            });
        }

        // Inject script
        await antigravityBridge.page.evaluate((code) => {
            try {
                eval(code);
                console.log('[ActionDetector] Script injected via CDP');
            } catch (e) {
                console.error('[ActionDetector] Injection error:', e.message);
            }
        }, scriptContent);

        // Start the action detector with WebSocket URL
        const wsUrl = `ws://localhost:${process.env.PORT || 8000}/ws/action-bridge`;
        await antigravityBridge.page.evaluate((url) => {
            if (typeof window.__startActionDetector === 'function') {
                window.__startActionDetector({
                    wsUrl: url,
                    pollInterval: 500,
                    debug: true
                });
                console.log('[ActionDetector] Started with WebSocket:', url);
            }
        }, wsUrl);

        // Verify injection
        const verified = await antigravityBridge.page.evaluate(() => {
            return typeof window.__startActionDetector !== 'undefined';
        });

        res.json({
            success: verified,
            message: verified ? 'detect_actions.js injected and started' : 'Injection verification failed',
            wsUrl: wsUrl,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('❌ Error injecting action detector:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/inject/all
 * Inject ALL scripts vào Antigravity console qua CDP
 * Đây là endpoint chính để inject một lần cho tất cả
 */
router.post('/all', async (req, res) => {
    try {
        const antigravityBridge = req.app.locals.antigravityBridge;

        if (!antigravityBridge) {
            return res.status(503).json({
                error: 'AntigravityBridge service not available'
            });
        }

        console.log('🚀 Starting CDP injection for all scripts...');

        // Ensure connected to CDP
        const connected = await antigravityBridge.connect();
        if (!connected) {
            return res.status(503).json({
                error: 'Cannot connect to Antigravity CDP. Make sure Antigravity is running with --remote-debugging-port=9000'
            });
        }

        const results = {
            chatBridge: false,
            actionDetector: false,
            errors: []
        };

        // ===== 1. Inject chat_bridge_ws.js =====
        try {
            results.chatBridge = await antigravityBridge.injectChatBridge();
            console.log(`✅ chat_bridge_ws.js: ${results.chatBridge ? 'SUCCESS' : 'SKIPPED (already injected)'}`);
        } catch (e) {
            results.errors.push(`chat_bridge: ${e.message}`);
            console.error('❌ chat_bridge_ws.js injection error:', e.message);
        }

        // ===== 2. Inject detect_actions.js =====
        try {
            const scriptPath = path.join(__dirname, '../../scripts/detect_actions.js');

            if (fs.existsSync(scriptPath)) {
                // Check if already injected
                const alreadyInjected = await antigravityBridge.page.evaluate(() => {
                    return typeof window.__startActionDetector !== 'undefined';
                });

                if (!alreadyInjected) {
                    const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

                    // Inject script
                    await antigravityBridge.page.evaluate((code) => {
                        try {
                            eval(code);
                        } catch (e) {
                            console.error('[ActionDetector] Injection error:', e.message);
                        }
                    }, scriptContent);

                    // Start detector with WebSocket
                    const wsUrl = `ws://localhost:${process.env.PORT || 8000}/ws/action-bridge`;
                    await antigravityBridge.page.evaluate((url) => {
                        if (typeof window.__startActionDetector === 'function') {
                            window.__startActionDetector({
                                wsUrl: url,
                                pollInterval: 500,
                                debug: true
                            });
                        }
                    }, wsUrl);

                    results.actionDetector = true;
                    console.log('✅ detect_actions.js: SUCCESS');
                } else {
                    results.actionDetector = true;
                    console.log('ℹ️ detect_actions.js: SKIPPED (already injected)');
                }
            } else {
                results.errors.push('detect_actions.js not found');
            }
        } catch (e) {
            results.errors.push(`action_detector: ${e.message}`);
            console.error('❌ detect_actions.js injection error:', e.message);
        }

        // Summary
        const allSuccess = results.chatBridge && results.actionDetector;
        console.log(`\n${'='.repeat(50)}`);
        console.log(`📦 CDP INJECTION COMPLETE`);
        console.log(`   chat_bridge_ws.js: ${results.chatBridge ? '✅' : '❌'}`);
        console.log(`   detect_actions.js: ${results.actionDetector ? '✅' : '❌'}`);
        console.log(`${'='.repeat(50)}\n`);

        res.json({
            success: allSuccess,
            results: results,
            message: allSuccess ? 'All scripts injected successfully' : 'Some scripts failed to inject',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('❌ Error in inject/all:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/inject/status
 * Check injection status
 */
router.get('/status', async (req, res) => {
    try {
        const antigravityBridge = req.app.locals.antigravityBridge;

        if (!antigravityBridge || !antigravityBridge.isConnected) {
            return res.json({
                connected: false,
                chatBridge: false,
                actionDetector: false,
                message: 'Not connected to Antigravity CDP'
            });
        }

        // Check injection status
        const status = await antigravityBridge.page.evaluate(() => {
            return {
                chatBridge: typeof window.chatBridge !== 'undefined',
                chatBridgeStatus: typeof window.chatBridge?.status === 'function' ? window.chatBridge.status() : null,
                actionDetector: typeof window.__startActionDetector !== 'undefined',
                actionStats: typeof window.__getActionStats === 'function' ? window.__getActionStats() : null
            };
        });

        res.json({
            connected: true,
            ...status,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
