Option Explicit

Dim shell, fso, root, pwsh, script, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
pwsh = shell.ExpandEnvironmentStrings("%USERPROFILE%") & _
    "\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe"
script = root & "\scripts\start_team_autostart.ps1"

command = """" & pwsh & """ -NoProfile -ExecutionPolicy Bypass -File """ & _
    script & """ -Port 8000"

shell.CurrentDirectory = root
shell.Run command, 0, False
