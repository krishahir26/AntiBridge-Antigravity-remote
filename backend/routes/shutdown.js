const express = require('express');
const router = express.Router();

/**
 * POST /api/shutdown
 * Tắt hoàn toàn server (KHÔNG restart)
 */
router.post('/', async (req, res) => {
    console.log('⛔ Shutdown request received');

    try {
        // Send success response first
        res.json({
            success: true,
            message: 'Server đang tắt...'
        });

        // Wait for response to be sent, then exit
        setTimeout(() => {
            console.log('👋 Server shutting down...');
            process.exit(0);
        }, 500);

    } catch (error) {
        console.error('❌ Shutdown error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
