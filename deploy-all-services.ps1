# Deploy All Services to Google Cloud Run
# This script builds and deploys all services in the services/ directory

$ErrorActionPreference = "Stop"

# Configuration
$PROJECT_ID = "bland-gcp-migration"
$REGION = "us-central1"
$REGISTRY = "$REGION-docker.pkg.dev/$PROJECT_ID/bland-services"

# Color output functions
function Write-Success { Write-Host $args[0] -ForegroundColor Green }
function Write-Info { Write-Host $args[0] -ForegroundColor Cyan }
function Write-Warning { Write-Host $args[0] -ForegroundColor Yellow }
function Write-Error { Write-Host $args[0] -ForegroundColor Red }

Write-Info "`n🚀 Starting deployment of all services to Google Cloud Run"
Write-Info "Project: $PROJECT_ID"
Write-Info "Region: $REGION"
Write-Info "Registry: $REGISTRY`n"

# Check if we're authenticated
Write-Info "Checking authentication..."
$authCheck = gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>$null
if (-not $authCheck) {
    Write-Error "Not authenticated with gcloud. Please run: gcloud auth login"
    exit 1
}
Write-Success "✓ Authenticated as: $authCheck"

# Set the project
Write-Info "Setting project..."
gcloud config set project $PROJECT_ID 2>$null
Write-Success "✓ Project set to: $PROJECT_ID"

# Configure Docker for Artifact Registry
Write-Info "`nConfiguring Docker for Artifact Registry..."
gcloud auth configure-docker $REGION-docker.pkg.dev --quiet 2>$null
Write-Success "✓ Docker configured for Artifact Registry"

# Get list of services
$services = @(
    @{name="availability"; memory="512Mi"; cpu="1"; minInstances=0; maxInstances=10},
    @{name="date-formatter"; memory="256Mi"; cpu="1"; minInstances=0; maxInstances=5},
    @{name="dob-normalize"; memory="256Mi"; cpu="1"; minInstances=0; maxInstances=5},
    @{name="email-validate"; memory="256Mi"; cpu="1"; minInstances=0; maxInstances=5},
    @{name="time-parser"; memory="256Mi"; cpu="1"; minInstances=0; maxInstances=5},
    @{name="zipcode-validate"; memory="256Mi"; cpu="1"; minInstances=0; maxInstances=5}
)

$totalServices = $services.Count
$successCount = 0
$failedServices = @()

Write-Info "`n📦 Found $totalServices services to deploy"

foreach ($service in $services) {
    $serviceName = $service.name
    $serviceDir = "services/$serviceName"
    
    Write-Info "`n========================================="
    Write-Info "Deploying: $serviceName-service"
    Write-Info "========================================="
    
    # Check if service directory exists
    if (-not (Test-Path $serviceDir)) {
        Write-Warning "⚠ Directory not found: $serviceDir - Skipping"
        $failedServices += $serviceName
        continue
    }
    
    # Build Docker image
    Write-Info "🔨 Building Docker image..."
    $imageName = "$REGISTRY/$serviceName-service"
    $imageTag = "$imageName`:latest"
    
    try {
        docker build -t $imageTag $serviceDir 2>&1 | Out-String
        Write-Success "✓ Docker image built: $imageTag"
    } catch {
        Write-Error "✗ Failed to build Docker image for $serviceName"
        $failedServices += $serviceName
        continue
    }
    
    # Push Docker image
    Write-Info "📤 Pushing image to Artifact Registry..."
    try {
        docker push $imageTag 2>&1 | Out-String
        Write-Success "✓ Image pushed to registry"
    } catch {
        Write-Error "✗ Failed to push image for $serviceName"
        $failedServices += $serviceName
        continue
    }
    
    # Deploy to Cloud Run
    Write-Info "☁️ Deploying to Cloud Run..."
    $fullServiceName = "$serviceName-service-production"
    
    try {
        $deployCommand = @"
gcloud run deploy $fullServiceName ``
    --image $imageTag ``
    --region $REGION ``
    --platform managed ``
    --allow-unauthenticated ``
    --port 8080 ``
    --cpu $($service.cpu) ``
    --memory $($service.memory) ``
    --min-instances $($service.minInstances) ``
    --max-instances $($service.maxInstances) ``
    --concurrency 80 ``
    --timeout 300 ``
    --set-env-vars="NODE_ENV=production,PROJECT_ID=$PROJECT_ID,REGION=$REGION,SERVICE_NAME=$serviceName" ``
    --labels="environment=production,managed-by=powershell" ``
    --quiet
"@
        
        Invoke-Expression $deployCommand 2>&1 | Out-String
        
        # Get service URL
        $serviceUrl = gcloud run services describe $fullServiceName --region $REGION --format "value(status.url)" 2>$null
        
        Write-Success "✓ Service deployed successfully!"
        Write-Success "  URL: $serviceUrl"
        
        # Test health endpoint
        Write-Info "🏥 Testing health endpoint..."
        try {
            $healthResponse = Invoke-WebRequest -Uri "$serviceUrl/health" -Method GET -UseBasicParsing -TimeoutSec 10
            if ($healthResponse.StatusCode -eq 200) {
                Write-Success "✓ Health check passed!"
            }
        } catch {
            Write-Warning "⚠ Health check failed or requires authentication"
        }
        
        $successCount++
        
    } catch {
        Write-Error "✗ Failed to deploy $serviceName to Cloud Run"
        Write-Error $_.Exception.Message
        $failedServices += $serviceName
    }
}

# Summary
Write-Info "`n========================================="
Write-Info "DEPLOYMENT SUMMARY"
Write-Info "========================================="
Write-Success "✓ Successfully deployed: $successCount/$totalServices services"

if ($successCount -gt 0) {
    Write-Info "`nDeployed services:"
    foreach ($service in $services) {
        if ($service.name -notin $failedServices) {
            $fullServiceName = "$($service.name)-service-production"
            $serviceUrl = gcloud run services describe $fullServiceName --region $REGION --format "value(status.url)" 2>$null
            if ($serviceUrl) {
                Write-Success "  • $($service.name): $serviceUrl"
            }
        }
    }
}

if ($failedServices.Count -gt 0) {
    Write-Warning "`n⚠ Failed services: $($failedServices -join ', ')"
    Write-Info "Run the script again to retry failed deployments"
}

Write-Info "`n🎉 Deployment process complete!"
Write-Info "View all services: https://console.cloud.google.com/run?project=$PROJECT_ID"
