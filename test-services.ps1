# Test All Deployed Services
Write-Host "`n🏥 Testing All Deployed Services" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan

# Get authentication token
$token = & gcloud.cmd auth print-identity-token

# List of services to test
$services = @(
    @{name="bland-api"; url="https://bland-api-production-333415133109.us-central1.run.app"},
    @{name="availability"; url="https://availability-service-production-333415133109.us-central1.run.app"},
    @{name="date-formatter"; url="https://date-formatter-service-production-333415133109.us-central1.run.app"},
    @{name="dob-normalize"; url="https://dob-normalize-service-production-333415133109.us-central1.run.app"},
    @{name="email-validate"; url="https://email-validate-service-production-333415133109.us-central1.run.app"},
    @{name="time-parser"; url="https://time-parser-service-production-333415133109.us-central1.run.app"},
    @{name="zipcode-validate"; url="https://zipcode-validate-service-production-333415133109.us-central1.run.app"}
)

$successCount = 0
$totalCount = $services.Count

foreach ($service in $services) {
    Write-Host "`nTesting: $($service.name)" -ForegroundColor Yellow
    $healthUrl = "$($service.url)/health"
    
    # Test with curl (more reliable for API testing)
    $curlCommand = "curl -s -H `"Authorization: Bearer $token`" $healthUrl"
    $response = & cmd /c $curlCommand 2>$null
    
    if ($response -like "*healthy*") {
        Write-Host "✅ Service is healthy!" -ForegroundColor Green
        $successCount++
        
        # Parse and display details if possible
        try {
            $json = $response | ConvertFrom-Json
            Write-Host "  Status: $($json.status)" -ForegroundColor Gray
            Write-Host "  Service: $($json.service)" -ForegroundColor Gray
            if ($json.version) {
                Write-Host "  Version: $($json.version)" -ForegroundColor Gray
            }
        } catch {
            # Just show that it's working even if we can't parse
        }
    } else {
        Write-Host "❌ Service check failed" -ForegroundColor Red
        if ($response) {
            Write-Host "  Response: $($response.Substring(0, [Math]::Min(100, $response.Length)))" -ForegroundColor Gray
        }
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "RESULTS: $successCount/$totalCount services healthy" -ForegroundColor $(if ($successCount -eq $totalCount) { "Green" } else { "Yellow" })
Write-Host "========================================" -ForegroundColor Cyan

if ($successCount -eq $totalCount) {
    Write-Host "`n🎉 All services are deployed and healthy!" -ForegroundColor Green
} else {
    Write-Host "`n⚠️ Some services may need attention" -ForegroundColor Yellow
}

Write-Host "`n📊 View all services in Cloud Console:" -ForegroundColor Cyan
Write-Host "https://console.cloud.google.com/run?project=bland-gcp-migration" -ForegroundColor Blue
