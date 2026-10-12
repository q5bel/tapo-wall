# tapo-wall launcher — see scripts/start.mjs for the actual logic.
$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot
node scripts/start.mjs @args
exit $LASTEXITCODE
