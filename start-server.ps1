# PowerShell script to start the Munkpin Worker Server
# Usage: .\start-server.ps1

Write-Host "Checking if port 3000 is in use..." -ForegroundColor Yellow

# Check if port 3000 is in use
$portInUse = netstat -ano | findstr :3000 | findstr LISTENING

if ($portInUse) {
    Write-Host "Port 3000 is already in use!" -ForegroundColor Red
    
    # Extract PID from the output
    $pidMatch = $portInUse | Select-String -Pattern '\s+(\d+)$'
    if ($pidMatch) {
        $processId = $pidMatch.Matches[0].Groups[1].Value
        Write-Host "Killing process with PID: $processId" -ForegroundColor Yellow
        taskkill /PID $processId /F 2>$null
        Start-Sleep -Seconds 1
        Write-Host "Process killed" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Starting Munkpin Worker Server..." -ForegroundColor Cyan
Write-Host "Server will be available at: http://localhost:3000" -ForegroundColor Green
Write-Host "Open test.html in Chrome to test the service" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""

# Start the server
node server.js
