param(
    [string]$HostAddress = "127.0.0.1",
    [int]$Port = 8000,
    [string]$Profile = "",
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$requestedPort = $Port
while (Get-NetTCPConnection -LocalAddress $HostAddress -LocalPort $Port -ErrorAction SilentlyContinue) {
    $Port += 1
}

if ($Port -ne $requestedPort) {
    Write-Host "Port $requestedPort is already in use. Using $Port instead."
}

$url = "http://${HostAddress}:${Port}/"

Write-Host "Starting Tagbum at $url"
Write-Host "Close this window or press Ctrl+C to stop the album server."

if (-not $NoBrowser) {
    Start-Job -ScriptBlock {
        param($TargetUrl)
        Start-Sleep -Seconds 3
        Start-Process $TargetUrl
    } -ArgumentList $url | Out-Null
}

$args = @("run", "-n", "tagbum", "python", "-m", "Tagbum", "web", "--host", $HostAddress, "--port", $Port)
if ($Profile) {
    $args += @("--profile", $Profile)
}

conda @args
