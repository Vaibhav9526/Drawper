# Drawper screen ink: a transparent, always-on-top drawing layer laid over the VS Code window.
param([Int64]$Target = 0)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Drawing, System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W32 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
[void][W32]::SetProcessDPIAware()
$script:target = if ($Target -ne 0) { [IntPtr]$Target } else { [W32]::GetForegroundWindow() }
$r = New-Object W32+RECT
if (-not [W32]::GetWindowRect($script:target, [ref]$r)) { exit 1 }

function Brush($hex) { (New-Object System.Windows.Media.BrushConverter).ConvertFromString($hex) }
$script:colors = @('#EC5451', '#FFD900', '#87DAC7', '#FFFFFF')
$script:ci = 0
$script:passThrough = $false

$ink = New-Object System.Windows.Window
$ink.WindowStyle = 'None'; $ink.AllowsTransparency = $true; $ink.Background = [System.Windows.Media.Brushes]::Transparent
$ink.Topmost = $true; $ink.ShowInTaskbar = $false; $ink.ShowActivated = $false; $ink.ResizeMode = 'NoResize'
$ink.Left = 0; $ink.Top = 0; $ink.Width = 100; $ink.Height = 100
$canvas = New-Object System.Windows.Controls.InkCanvas
$canvas.Background = Brush '#01000000'
$canvas.Cursor = [System.Windows.Input.Cursors]::Pen
$canvas.DefaultDrawingAttributes.Color = [System.Windows.Media.ColorConverter]::ConvertFromString($script:colors[0])
$canvas.DefaultDrawingAttributes.Width = 4
$canvas.DefaultDrawingAttributes.Height = 4
$canvas.DefaultDrawingAttributes.FitToCurve = $true
$ink.Content = $canvas

$bar = New-Object System.Windows.Window
$bar.WindowStyle = 'None'; $bar.AllowsTransparency = $true; $bar.Background = [System.Windows.Media.Brushes]::Transparent
$bar.Topmost = $true; $bar.ShowInTaskbar = $false; $bar.ShowActivated = $false; $bar.ResizeMode = 'NoResize'; $bar.SizeToContent = 'WidthAndHeight'
$border = New-Object System.Windows.Controls.Border
$border.Background = Brush '#2E2936'; $border.CornerRadius = 12; $border.Padding = 6; $border.BorderBrush = Brush '#FFD900'; $border.BorderThickness = 1
$row = New-Object System.Windows.Controls.StackPanel
$row.Orientation = 'Horizontal'
$border.Child = $row
$bar.Content = $border

$script:buttons = @{}
function Add-Button($name, $text, $action) {
  $b = New-Object System.Windows.Controls.Button
  $b.Content = $text; $b.Margin = '2'; $b.Padding = '10,5,10,5'; $b.MinWidth = 44
  $b.Background = Brush '#3b3547'; $b.Foreground = Brush '#F4F1FA'; $b.BorderThickness = 0; $b.FontSize = 12
  $b.Cursor = [System.Windows.Input.Cursors]::Hand
  $b.Add_Click($action)
  $row.Children.Add($b) | Out-Null
  $script:buttons[$name] = $b
}
function Mark-Active($name) {
  foreach ($k in @('pen', 'erase')) {
    $on = ($k -eq $name)
    $script:buttons[$k].Background = Brush $(if ($on) { '#FFD900' } else { '#3b3547' })
    $script:buttons[$k].Foreground = Brush $(if ($on) { '#2E2936' } else { '#F4F1FA' })
  }
}
function Set-PassThrough($on) {
  $script:passThrough = $on
  $h = (New-Object System.Windows.Interop.WindowInteropHelper($ink)).Handle
  $ex = [W32]::GetWindowLong($h, -20)
  if ($on) { [void][W32]::SetWindowLong($h, -20, ($ex -bor 0x20)) } else { [void][W32]::SetWindowLong($h, -20, ($ex -band (-bnot 0x20))) }
  $script:buttons['scroll'].Content = $(if ($on) { 'Draw' } else { 'Scroll' })
}
$undo = { if ($canvas.Strokes.Count -gt 0) { $canvas.Strokes.RemoveAt($canvas.Strokes.Count - 1) } }

Add-Button 'pen' 'Pen' { $canvas.EditingMode = 'Ink'; $canvas.Cursor = [System.Windows.Input.Cursors]::Pen; Mark-Active 'pen' }
Add-Button 'erase' 'Erase' { $canvas.EditingMode = 'EraseByStroke'; $canvas.Cursor = [System.Windows.Input.Cursors]::Arrow; Mark-Active 'erase' }
Add-Button 'color' 'Color' {
  $script:ci = ($script:ci + 1) % $script:colors.Count
  $canvas.DefaultDrawingAttributes.Color = [System.Windows.Media.ColorConverter]::ConvertFromString($script:colors[$script:ci])
  $script:buttons['color'].Foreground = Brush $script:colors[$script:ci]
}
Add-Button 'undo' 'Undo' $undo
Add-Button 'clear' 'Clear' { $canvas.Strokes.Clear() }
Add-Button 'scroll' 'Scroll' { Set-PassThrough (-not $script:passThrough) }
Add-Button 'copy' 'Copy' {
  $bar.Visibility = 'Hidden'
  Start-Sleep -Milliseconds 200
  $cur = New-Object W32+RECT
  [void][W32]::GetWindowRect($script:target, [ref]$cur)
  $w = $cur.R - $cur.L; $h = $cur.B - $cur.T
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($cur.L, $cur.T, 0, 0, (New-Object System.Drawing.Size $w, $h), [System.Drawing.CopyPixelOperation]([int]0x40CC0020))
  [System.Windows.Forms.Clipboard]::SetImage($bmp)
  $g.Dispose(); $bmp.Dispose()
  $bar.Visibility = 'Visible'
  $script:buttons['copy'].Content = 'Copied'
  $t = New-Object System.Windows.Threading.DispatcherTimer
  $t.Interval = [TimeSpan]::FromMilliseconds(1200)
  $t.Add_Tick({ $script:buttons['copy'].Content = 'Copy'; $this.Stop() })
  $t.Start()
}
Add-Button 'done' 'Done' { $ink.Close() }
$script:buttons['done'].Background = Brush '#EC5451'
$script:buttons['color'].Foreground = Brush $script:colors[0]
Mark-Active 'pen'

$ink.Add_KeyDown({
  if ($_.Key -eq 'Escape') { $ink.Close() }
  elseif ($_.Key -eq 'Z' -and ([System.Windows.Input.Keyboard]::Modifiers -band 'Control')) { & $undo }
  elseif ($_.Key -eq 'Delete') { $canvas.Strokes.Clear() }
})
$ink.Add_Closed({ $bar.Close(); [System.Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown() })

function Place {
  $cur = New-Object W32+RECT
  if (-not [W32]::GetWindowRect($script:target, [ref]$cur)) { return }
  $hi = (New-Object System.Windows.Interop.WindowInteropHelper($ink)).Handle
  [void][W32]::SetWindowPos($hi, [IntPtr]::new(-1), $cur.L, $cur.T, ($cur.R - $cur.L), ($cur.B - $cur.T), 0x0010)
  $hb = (New-Object System.Windows.Interop.WindowInteropHelper($bar)).Handle
  $scale = [System.Windows.PresentationSource]::FromVisual($bar).CompositionTarget.TransformToDevice.M11
  $bw = [int]($bar.ActualWidth * $scale)
  [void][W32]::SetWindowPos($hb, [IntPtr]::new(-1), ($cur.R - $bw - [int](150 * $scale)), ($cur.T + [int](60 * $scale)), 0, 0, 0x0011)
}

$ink.Show()
$bar.Show()
Place

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(400)
$timer.Add_Tick({
  if (-not [W32]::IsWindow($script:target)) { $ink.Close(); return }
  $fg = [W32]::GetForegroundWindow()
  $hi = (New-Object System.Windows.Interop.WindowInteropHelper($ink)).Handle
  $hb = (New-Object System.Windows.Interop.WindowInteropHelper($bar)).Handle
  $visible = (-not [W32]::IsIconic($script:target)) -and ($fg -eq $script:target -or $fg -eq $hi -or $fg -eq $hb)
  $want = if ($visible) { 'Visible' } else { 'Hidden' }
  if ($ink.Visibility.ToString() -ne $want) { $ink.Visibility = $want; $bar.Visibility = $want }
  if ($visible) { Place }
})
$timer.Start()
[System.Windows.Threading.Dispatcher]::Run()
