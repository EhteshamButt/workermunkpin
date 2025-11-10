# PowerShell script to kill process on port 3000
# Usage: .\kill-port.ps1

param(
    [int]$Port = 3000
)

Write-Host "Checking for processes on port $Port..." -ForegroundColor Yellow

$connections = netstat -ano | findstr ":$Port" | findstr LISTENING

if ($connections) {
    $pids = $connections | ForEach-Object {
        if ($_ -match '\s+(\d+)$') {
            $matches[1]
        }
    } | Select-Object -Unique
    
    foreach ($processId in $pids) {
        Write-Host "Killing process with PID: $processId" -ForegroundColor Yellow
        taskkill /PID $processId /F 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Process $processId killed successfully" -ForegroundColor Green
        } else {
            Write-Host "Failed to kill process $processId" -ForegroundColor Red
        }
    }
} else {
    Write-Host "No processes found on port $Port" -ForegroundColor Green
}
