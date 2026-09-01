[CmdletBinding()]
param(
  [string]$LoginPath = "revex-demo-dryrun",
  [string]$DatabaseName = "revex_demo_requests_dryrun_20260901",
  [string]$MigrationPath
)

$ErrorActionPreference = "Stop"
$nativePreference = Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
if ($nativePreference) { $PSNativeCommandUseErrorActionPreference = $false }
$expectedDatabaseName = "revex_demo_requests_dryrun_20260901"

if ([string]::IsNullOrWhiteSpace($MigrationPath)) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $MigrationPath = Join-Path $scriptDirectory "..\db\migrations\2026-09-01-demo-requests.sql"
}

if ($DatabaseName -ne $expectedDatabaseName) {
  throw "Refusing to run: DatabaseName must be exactly $expectedDatabaseName"
}

$mysql = Get-Command mysql.exe -ErrorAction Stop
$migration = (Resolve-Path -LiteralPath $MigrationPath).Path.Replace("\", "/")
$verified = $false

function Invoke-MySql {
  param(
    [Parameter(Mandatory)]
    [string]$Sql,
    [switch]$UseDatabase,
    [switch]$ExpectFailure
  )

  $arguments = @("--login-path=$LoginPath", "--batch", "--raw")
  if ($UseDatabase) { $arguments += "--database=$DatabaseName" }
  $arguments += "--execute=$Sql"

  & $mysql.Source @arguments
  $exitCode = $LASTEXITCODE

  if ($ExpectFailure) {
    if ($exitCode -eq 0) { throw "Expected SQL statement to fail, but it succeeded." }
    return
  }

  if ($exitCode -ne 0) { throw "mysql exited with code $exitCode" }
}

try {
  Write-Host "Creating fixed disposable database: $DatabaseName"
  Invoke-MySql -Sql "CREATE DATABASE IF NOT EXISTS ``$DatabaseName`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

  Write-Host "Applying migration for the first time"
  Invoke-MySql -UseDatabase -Sql "source $migration;"

  Write-Host "Testing a valid insert"
  Invoke-MySql -UseDatabase -Sql @"
INSERT INTO demo_requests
  (full_name, company_name, email, mobile, number_of_users)
VALUES
  ('Dry Run User', 'Dry Run Company', 'dryrun@example.invalid', '+910000000000', 5);
"@

  Write-Host "Confirming invalid notification status is rejected"
  Invoke-MySql -UseDatabase -ExpectFailure -Sql @"
INSERT INTO demo_requests
  (full_name, company_name, email, mobile, notification_email_status)
VALUES
  ('Invalid Status', 'Dry Run Company', 'invalid-status@example.invalid', '+910000000001', 'invalid');
"@

  Write-Host "Confirming invalid number_of_users is rejected"
  Invoke-MySql -UseDatabase -ExpectFailure -Sql @"
INSERT INTO demo_requests
  (full_name, company_name, email, mobile, number_of_users)
VALUES
  ('Invalid Users', 'Dry Run Company', 'invalid-users@example.invalid', '+910000000002', 0);
"@

  Write-Host "Applying migration for the second time"
  Invoke-MySql -UseDatabase -Sql "source $migration;"

  Write-Host "Confirming the first valid row survived the idempotency run"
  $rowCheck = @(Invoke-MySql -UseDatabase -Sql @"
SELECT IF(COUNT(*) = 1, 'PASS', 'FAIL') AS row_check
FROM demo_requests
WHERE email = 'dryrun@example.invalid';
"@)
  if ($rowCheck[-1] -ne "PASS") {
    throw "Idempotency verification failed: expected exactly one preserved test row."
  }

  $verified = $true
  Write-Host "Dry run passed. Dropping the disposable database."
  Invoke-MySql -Sql "DROP DATABASE ``$DatabaseName``;"
} finally {
  if (-not $verified) {
    Write-Warning "Dry run did not complete. The disposable database was preserved for inspection: $DatabaseName"
  }
}
