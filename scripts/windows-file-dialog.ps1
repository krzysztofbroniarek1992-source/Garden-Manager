param(
  [Parameter(Mandatory = $true)][int]$OwnerProcessId,
  [Parameter(Mandatory = $true)][ValidateSet('choose', 'cancel')][string]$Action,
  [string]$FilePath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
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
if ($Action -eq 'choose') {
  if (!$FilePath) { throw 'Missing controlled test file path.' }
  $fieldCondition = [System.Windows.Automation.AndCondition]::new(
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1001'),
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit))
  $field = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $fieldCondition)
  if (!$field) { throw 'Native file-name edit control was not found.' }
  $value = $field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $value.SetValue($FilePath)
}
$buttonId = if ($Action -eq 'cancel') { '2' } else { '1' }
$button = $dialog.FindFirst(
  [System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $buttonId))
if (!$button) { throw 'Native Open/Save/Cancel button was not found.' }
$invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$invoke.Invoke()
