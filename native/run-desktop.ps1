param([string]$Server = 'http://localhost:3001', [string]$Name = '', [switch]$NoServer, [switch]$NoBuild)
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$portableSdk = Join-Path $env:LOCALAPPDATA 'Tonarium\dotnet\dotnet.exe'
$sdk = if (Test-Path -LiteralPath $portableSdk) { $portableSdk } else { (Get-Command dotnet -ErrorAction Stop).Source }
$env:DOTNET_ROOT = Split-Path $sdk -Parent
$project = Join-Path $PSScriptRoot 'Tonarium.Desktop\Tonarium.Desktop.csproj'
$executable = Join-Path $PSScriptRoot 'Tonarium.Desktop\bin\Debug\net10.0-windows\Tonarium.exe'
if (-not $NoBuild -or -not (Test-Path -LiteralPath $executable)) { & $sdk build $project --nologo; if ($LASTEXITCODE -ne 0) { throw 'デスクトップ版をビルドできませんでした' } }
$startedServer = $null
try {
    $endpoint = [Uri]$Server
    if (-not $NoServer -and $endpoint.IsLoopback) {
        try { $null = Invoke-WebRequest -Uri "$($Server.TrimEnd('/'))/healthz" -TimeoutSec 2 } catch {
            $logDirectory = Join-Path $env:LOCALAPPDATA 'Tonarium'
            New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
            $oldPort = $env:SERVER_PORT
            try {
                $env:SERVER_PORT = $endpoint.Port
                $node = (Get-Command node -ErrorAction Stop).Source
                $startedServer = Start-Process -FilePath $node -ArgumentList @('node_modules/tsx/dist/cli.mjs','server/index.ts','--dev') -WorkingDirectory $repository -RedirectStandardOutput (Join-Path $logDirectory 'server.log') -RedirectStandardError (Join-Path $logDirectory 'server-error.log') -PassThru -WindowStyle Hidden
            } finally { $env:SERVER_PORT = $oldPort }
            for ($attempt = 0; $attempt -lt 30; $attempt++) { try { $null = Invoke-WebRequest -Uri "$($Server.TrimEnd('/'))/healthz" -TimeoutSec 1; break } catch { Start-Sleep -Milliseconds 300 } }
        }
    }
    $arguments = @('--server', $Server)
    if ($Name) { $arguments += @('--name', $Name) }
    & $executable @arguments
} finally {
    if ($startedServer -and -not $startedServer.HasExited) {
        # 先に閉じたクライアントが、残っているクライアントの接続先を止めないようにする。
        while (Get-Process -Name Tonarium -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 1 }
        if (-not $startedServer.HasExited) { Stop-Process -Id $startedServer.Id }
    }
}
