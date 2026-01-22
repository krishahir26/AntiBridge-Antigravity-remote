' AntiBridge v3.0.0 - Open Antigravity with CDP (Silent)
' This script opens Antigravity with --remote-debugging-port=9000
' No CMD window will appear

Set WshShell = CreateObject("WScript.Shell")

' Antigravity path
AntigravityPath = """C:\Users\Admin\AppData\Local\Programs\antigravity\Antigravity.exe"""

' CDP Port
CDPPort = "9000"

' Command to run
Command = AntigravityPath & " --remote-debugging-port=" & CDPPort

' Run with normal window (1 = show window, False = don't wait)
WshShell.Run Command, 1, False

' Optional: Show notification
' MsgBox "Antigravity started with CDP port " & CDPPort, vbInformation, "AntiBridge"
