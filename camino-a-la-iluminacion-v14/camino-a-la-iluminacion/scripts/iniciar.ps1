# Carga las variables de .env y arranca el servidor (Windows / PowerShell). Ejecutar desde la raíz del proyecto.
if (-not (Test-Path .env)) { Write-Host "Crea el archivo .env a partir de .env.example"; exit 1 }
Get-Content .env | Where-Object { $_ -match '^\s*[A-Z_]+=' } | ForEach-Object {
  $k, $v = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($k.Trim(), $v.Split('#')[0].Trim(), 'Process')
}
Set-Location backend
mvn compile exec:java
