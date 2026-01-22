const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');

/**
 * POST /api/restart
 * Tự spawn process mới trước khi exit (Self-restart)
 */
router.post('/', async (req, res) => {
    console.log('📢 Restart request received');

    try {
        // Send success response first
        res.json({
            success: true,
            message: 'Server đang khởi động lại...'
        });

        // Wait for response to be sent
        setTimeout(() => {
            console.log('🔄 Spawning new server process...');

            // Tìm đường dẫn đến server.js
            const serverPath = path.join(__dirname, '..', 'server.js');

            // Spawn process mới với detached mode
            const child = spawn('node', [serverPath], {
                detached: true,  // Chạy độc lập
                stdio: 'ignore', // Không kế thừa stdio
                cwd: path.join(__dirname, '..'), // Working directory là backend folder
                env: process.env // Kế thừa environment variables
            });

            // Cho phép process cha exit mà không đợi con
            child.unref();

            console.log(`✅ New server spawned with PID: ${child.pid}`);
            console.log('👋 Old server exiting...');

            // Exit process hiện tại
            process.exit(0);

        }, 500);

    } catch (error) {
        console.error('❌ Restart error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
