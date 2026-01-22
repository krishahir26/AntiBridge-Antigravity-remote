/**
 * Snapshot route - capture Antigravity UI HTML/CSS for monitoring.
 */

const express = require('express');
const crypto = require('crypto');

const router = express.Router();

router.get('/', async (req, res) => {
    const { antigravityBridge } = req.app.locals;
    if (!antigravityBridge) {
        return res.status(503).json({ error: 'Antigravity bridge not available' });
    }

    try {
        if (!antigravityBridge.isConnected) {
            const connected = await antigravityBridge.connect();
            if (!connected) {
                return res.status(503).json({ error: 'Cannot connect to Antigravity CDP' });
            }
        }

        const page = antigravityBridge.page;
        if (!page) {
            return res.status(503).json({ error: 'Antigravity page not ready' });
        }

        const captureSnapshot = async (frame) => {
            return frame.evaluate(() => {
                const root = document.getElementById('cascade')
                    || document.querySelector('#cascade, [id^="cascade"]')
                    || document.querySelector('main')
                    || document.querySelector('[role="main"]')
                    || document.body;

                if (!root) {
                    return { error: 'root_not_found' };
                }

                const clone = root.cloneNode(true);
                const inputEl = clone.querySelector('[contenteditable="true"], textarea');
                if (inputEl) {
                    const wrapper = inputEl.closest('div') || inputEl;
                    wrapper.remove();
                }

                const textLength = (root.innerText || root.textContent || '').trim().length;
                let css = '';
                for (const sheet of document.styleSheets) {
                    try {
                        for (const rule of sheet.cssRules) {
                            let text = rule.cssText;
                            text = text.replace(/(^|[\s,}])body(?=[\s,{])/gi, '$1#snapshot-root');
                            text = text.replace(/(^|[\s,}])html(?=[\s,{])/gi, '$1#snapshot-root');
                            css += text + '\n';
                        }
                    } catch (e) {
                        // Ignore cross-origin styles
                    }
                }

                const bodyStyles = window.getComputedStyle(document.body);
                return {
                    html: clone.outerHTML,
                    css,
                    bodyBg: bodyStyles.backgroundColor,
                    bodyColor: bodyStyles.color,
                    textLength
                };
            });
        };

        let snapshot = null;
        const frames = page.frames();
        const mainFrame = page.mainFrame();
        const candidates = frames.map(frame => ({
            frame,
            url: frame.url()
        }));

        const isChatFrame = (url) => {
            const lower = (url || '').toLowerCase();
            if (!lower || lower === 'about:blank' || lower.includes('devtools')) {
                return false;
            }
            // PRIORITY: workbench.html is the main Antigravity UI
            // Avoid webview wrappers that just contain iframes
            return lower.includes('workbench')
                || lower.includes('cascade-panel')
                || lower.includes('agentpanel');
        };

        candidates.sort((a, b) => {
            const aScore = isChatFrame(a.url) ? 1 : 0;
            const bScore = isChatFrame(b.url) ? 1 : 0;
            return bScore - aScore;
        });

        for (const item of candidates) {
            try {
                // SKIP webview wrappers (frames that only have iframe pointing to fake.html)
                const isWrapper = await item.frame.evaluate(() => {
                    const iframes = document.querySelectorAll('iframe');
                    const scripts = document.querySelectorAll('script');
                    const hasServiceWorker = Array.from(scripts).some(s =>
                        s.textContent.includes('serviceWorker') || s.textContent.includes('navigator.serviceWorker')
                    );
                    // If frame has iframe + service worker code = wrapper!
                    return iframes.length > 0 && hasServiceWorker;
                }).catch(() => false);

                if (isWrapper) {
                    console.log(`⏭️ Skipping webview wrapper: ${item.url}`);
                    continue;
                }

                const candidate = await captureSnapshot(item.frame);
                if (!candidate || candidate.error) {
                    continue;
                }
                candidate.frameUrl = item.url || '';
                if (!snapshot || candidate.textLength > snapshot.textLength) {
                    snapshot = candidate;
                }
                if (candidate.textLength >= 300) {
                    break;
                }
            } catch (err) {
                console.error(`Error checking frame ${item.url}:`, err.message);
            }
        }

        if (!snapshot && mainFrame) {
            const candidate = await captureSnapshot(mainFrame);
            if (candidate && !candidate.error) {
                snapshot = candidate;
                snapshot.frameUrl = mainFrame.url();
            }
        }

        if (!snapshot || snapshot.error) {
            return res.status(404).json({ error: snapshot?.error || 'snapshot_failed' });
        }

        const hash = crypto.createHash('md5').update(snapshot.html || '').digest('hex');
        return res.json({ ...snapshot, hash });
    } catch (err) {
        console.error('Snapshot error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
