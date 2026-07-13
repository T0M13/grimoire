# Gracefully stop the hidden Grimoire host and every process it owns.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction Stop).Source
& $node (Join-Path $root "tools\host\stop.mjs") $root
exit $LASTEXITCODE
