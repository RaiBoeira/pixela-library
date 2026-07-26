Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$catalogScript = Join-Path $PSScriptRoot "generate_catalog_local.py"

Write-Host "Gerando catalogo..."
python $catalogScript

Write-Host ""
Write-Host "Abrindo servidor local em http://127.0.0.1:8123/web/"
Write-Host "Use Ctrl+C para encerrar."

Set-Location $root
python -m http.server 8123 --bind 127.0.0.1
