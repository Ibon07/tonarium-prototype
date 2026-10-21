param(
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string]$Server,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [string]$Session = 'lounge',
    [string]$PlayerPath
)
$ErrorActionPreference = 'Stop'
$executablePath = (Resolve-Path -LiteralPath $Executable).Path
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
if (-not ('LifecycleWindows' -as [type])) {
    Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class LifecycleWindows {
    private delegate bool EnumProc(IntPtr hwnd, IntPtr param);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr param);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    public static IntPtr[] Windows(int processId) {
        var result = new List<IntPtr>();
        EnumWindows((hwnd, _) => {
            GetWindowThreadProcessId(hwnd, out uint pid);
            if (pid == processId && IsWindowVisible(hwnd)) result.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }
}
'@
}
$results = @()
foreach ($route in @('parent', 'hud')) {
    $dataPath = Join-Path $outputRoot $route
    $info = [Diagnostics.ProcessStartInfo]::new($executablePath)
    $info.UseShellExecute = $false
    $info.WorkingDirectory = Split-Path -Parent $executablePath
    foreach ($argument in @('--connect', '--server', $Server, '--name', "Lifecycle-$route", '--session', $Session, '--3d', '--data-dir', $dataPath)) {
        $info.ArgumentList.Add($argument)
    }
    if ($PlayerPath) { $info.Environment['TONARIUM_UNITY_PLAYER'] = (Resolve-Path -LiteralPath $PlayerPath).Path }
    $process = [Diagnostics.Process]::Start($info)
    $childIds = @()
    try {
        $watch = [Diagnostics.Stopwatch]::StartNew()
        $parentWindow = [IntPtr]::Zero
        $hudWindow = [IntPtr]::Zero
        do {
            if ($process.HasExited) { throw "App exited during startup: $($process.ExitCode)" }
            $windows = [LifecycleWindows]::Windows($process.Id)
            $parentWindow = @($windows | Where-Object { [LifecycleWindows]::GetWindow($_, 4) -eq [IntPtr]::Zero }) | Select-Object -First 1
            $hudWindow = @($windows | Where-Object { [LifecycleWindows]::GetWindow($_, 4) -ne [IntPtr]::Zero }) | Select-Object -First 1
            $childIds = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($process.Id) AND Name='Tonarium3D.exe'" | Select-Object -ExpandProperty ProcessId)
            if ($parentWindow -and $hudWindow -and $childIds.Count -gt 0) { break }
            Start-Sleep -Milliseconds 100
        } while ($watch.Elapsed.TotalSeconds -lt 50)
        if (-not $parentWindow -or -not $hudWindow -or $childIds.Count -eq 0) { throw '3D windows/player did not appear' }
        # Allow the real player to complete embedding before issuing a close.
        Start-Sleep -Seconds 3
        $target = if ($route -eq 'parent') { $parentWindow } else { $hudWindow }
        [LifecycleWindows]::SetForegroundWindow($target) | Out-Null
        for ($repeat = 0; $repeat -lt 3; $repeat++) {
            [LifecycleWindows]::PostMessage($target, 0x0112, [IntPtr]::new(0xF060), [IntPtr]::Zero) | Out-Null
        }
        if (-not $process.WaitForExit(20000)) { throw 'App did not finish shutdown within 20 seconds' }
        if ($process.ExitCode -ne 0) { throw "App exit code $($process.ExitCode)" }
        foreach ($childId in $childIds) {
            if (Get-Process -Id $childId -ErrorAction SilentlyContinue) { throw "Unity child $childId survived shutdown" }
        }
        $results += @{ route = $route; exitCode = $process.ExitCode; unityChildIds = $childIds; passed = $true }
        Write-Output "PASS packaged $route close: clean exit, no surviving Unity child"
    }
    finally {
        if (-not $process.HasExited) { $process.Kill($true); $process.WaitForExit() }
        $process.Dispose()
    }
}
@{ executable = $executablePath; passed = $true; checks = $results } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputRoot 'result.json')
