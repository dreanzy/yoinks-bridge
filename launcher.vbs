' yoinks:// protocol launcher
'
' Called from the registry command:
'   wscript.exe launcher.vbs "yoinks://dl?url=..."
'
' wscript is a GUI-subsystem host, so no console window flashes on screen;
' it only decodes nothing and forwards the raw argument to handler.mjs.
Option Explicit

Dim sh, fso, here, arg, args
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)

arg = ""
If WScript.Arguments.Count > 0 Then arg = WScript.Arguments(0)
arg = Replace(arg, """", "")   ' a double quote would break the command line below

args = """" & fso.BuildPath(here, "handler.mjs") & """ """ & arg & """"

On Error Resume Next
sh.Run "node.exe " & args, 0, False
If Err.Number <> 0 Then
  MsgBox "Cannot start node.exe. Make sure Node.js is installed and on PATH." & vbCrLf & vbCrLf & _
         "Command:" & vbCrLf & "node.exe " & args, 16, "yoinks"
End If
