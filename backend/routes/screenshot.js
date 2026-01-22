/**
 * Screenshot Routes
 * Chụp và gửi screenshot về điện thoại
 */

const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Đường dẫn lưu screenshot
const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'frontend');

/**
 * POST /api/screenshot
 * Chụp screenshot và trả về đường dẫn
 */
router.post('/', async (req, res) => {
    try {
        const timestamp = Date.now();
        const filename = `screenshot_${timestamp}.png`;
        const filepath = path.join(SCREENSHOT_DIR, filename);

        // PowerShell script để chụp CHỈ cửa sổ Antigravity
        const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}
"@

# Tìm cửa sổ Antigravity
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*Antigravity*' -and $_.MainWindowTitle -notlike '*Manager*' } | Select-Object -First 1

if ($proc -and $proc.MainWindowHandle -ne 0) {
    $hwnd = $proc.MainWindowHandle
    $rect = New-Object RECT
    [Win32]::GetWindowRect($hwnd, [ref]$rect)
    
    $windowWidth = $rect.Right - $rect.Left
    $windowHeight = $rect.Bottom - $rect.Top
    
    # Chụp chỉ 1/3 bên phải (Chat panel)
    $chatWidth = [int]($windowWidth * 0.35)
    $chatLeft = $rect.Right - $chatWidth
    
    $bitmap = New-Object System.Drawing.Bitmap($chatWidth, $windowHeight)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($chatLeft, $rect.Top, 0, 0, (New-Object System.Drawing.Size($chatWidth, $windowHeight)))
    $bitmap.Save("${filepath.replace(/\\/g, '\\\\')}")
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Host "OK"
} else {
    # Fallback: chụp toàn màn hình
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
    $bitmap.Save("${filepath.replace(/\\/g, '\\\\')}")
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Host "FULL"
}
`;

        const psScriptPath = path.join(__dirname, '..', 'temp_screenshot.ps1');
        fs.writeFileSync(psScriptPath, psScript, 'utf8');

        exec(`powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`, (err, stdout, stderr) => {
            // Xóa script tạm
            try { fs.unlinkSync(psScriptPath); } catch (e) { }

            if (err) {
                console.error('❌ Screenshot error:', err.message);
                return res.status(500).json({ error: err.message });
            }

            console.log('📸 Screenshot captured:', filename);

            // Xóa screenshot cũ (giữ chỉ 5 file gần nhất)
            cleanupOldScreenshots(SCREENSHOT_DIR);

            res.json({
                ok: true,
                url: `/${filename}`,
                timestamp
            });
        });

    } catch (err) {
        console.error('❌ Screenshot error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Xóa các screenshot cũ
 */
function cleanupOldScreenshots(dir) {
    try {
        const files = fs.readdirSync(dir)
            .filter(f => f.startsWith('screenshot_') && f.endsWith('.png'))
            .map(f => ({
                name: f,
                time: parseInt(f.replace('screenshot_', '').replace('.png', ''))
            }))
            .sort((a, b) => b.time - a.time);

        // Giữ 5 file mới nhất, xóa còn lại
        files.slice(5).forEach(f => {
            try {
                fs.unlinkSync(path.join(dir, f.name));
            } catch (e) { }
        });
    } catch (e) { }
}

module.exports = router;
