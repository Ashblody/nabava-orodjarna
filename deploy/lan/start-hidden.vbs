Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Environment("Process")("NABAVA_DATA_DIR") = dir & "\data"
sh.Environment("Process")("PORT") = "8787"
nodeExe = dir & "\runtime\node\node.exe"
serverJs = dir & "\server\index.js"
If Not fso.FileExists(nodeExe) Then
  MsgBox "MANJKA runtime\node\node.exe", 16, "Nabava Orodjarna"
  WScript.Quit 1
End If
' 0 = skrito okno (ni v orodni vrstici)
sh.Run """" & nodeExe & """ """ & serverJs & """", 0, False
