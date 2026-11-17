Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path node_modules)) { npm install }
node src/cli.mjs apply @args
