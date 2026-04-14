param(
  [int]$Port = 3000
)

Set-Location $PSScriptRoot
Set-Location ..

$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $conn) {
  Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
  Write-Output "Stopped PID $($conn.OwningProcess) on port $Port."
} else {
  Write-Output "No process on port $Port."
}

Write-Output "Starting app..."
npm start
