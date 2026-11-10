param(
  [Parameter(Mandatory = $true)][int]$OwnerProcessId,
  [Parameter(Mandatory = $true)][ValidateSet('choose', 'cancel')][string]$Action,
  [string]$FilePath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GMDialogFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$deadline = [DateTime]::UtcNow.AddSeconds(30)
$dialog = $null
while ([DateTime]::UtcNow -lt $deadline) {
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.AndCondition]::new(
      [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $OwnerProcessId),
      [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32770')))
  foreach ($window in $windows) {
    if ($window.Current.ClassName -eq '#32770') { $dialog = $window; break }
  }
  if ($dialog) { break }
  Start-Sleep -Milliseconds 100
}
if (!$dialog) {
  $roots = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition)
  $description = @($roots | ForEach-Object {
    "PID=$($_.Current.ProcessId); class=$($_.Current.ClassName); name=$($_.Current.Name)"
  }) -join "`n"
  throw "A real Windows common file dialog did not open for PID $OwnerProcessId. Desktop: $description"
}
Write-Host "REAL Windows dialog: $($dialog.Current.Name)"
$handle = [IntPtr]::new($dialog.Current.NativeWindowHandle)
[void][GMDialogFocus]::SetForegroundWindow($handle)
$focusDeadline = [DateTime]::UtcNow.AddSeconds(5)
while ([GMDialogFocus]::GetForegroundWindow() -ne $handle -and [DateTime]::UtcNow -lt $focusDeadline) {
  Start-Sleep -Milliseconds 100
}
if ([GMDialogFocus]::GetForegroundWindow() -ne $handle) { throw 'The actual native dialog did not receive keyboard focus.' }
if ($Action -eq 'choose') {
  if (!$FilePath) { throw 'Missing controlled test file path.' }
  # Windows runner uses en-US shell mnemonics. Paste Unicode without depending on
  # a particular IFileDialog control provider/automation ID or keyboard layout.
  [System.Windows.Forms.Clipboard]::SetText($FilePath)
  [System.Windows.Forms.SendKeys]::SendWait('%n')
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
} else {
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
}
