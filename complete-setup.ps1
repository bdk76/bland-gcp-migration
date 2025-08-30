# Complete GCP Setup Script

$PROJECT_ID = "bland-gcp-migration"
$REGION = "us-central1"
$ZONE = "us-central1-a"
$SERVICE_ACCOUNT_NAME = "bland-service-account"
$GITHUB_OWNER = "bdk76"
$GITHUB_REPO = "bland-gcp-migration"

Write-Host "Continuing GCP setup..." -ForegroundColor Green

# Set default region and zone
Write-Host "Setting default region and zone..." -ForegroundColor Cyan
gcloud config set compute/region $REGION
gcloud config set compute/zone $ZONE

# Create service account
Write-Host "Creating service account..." -ForegroundColor Cyan
$saEmail = "${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud iam service-accounts create $SERVICE_ACCOUNT_NAME `
    --display-name="Bland Service Account" `
    --description="Service account for Bland AI application" 2>$null

# Grant IAM roles to service account
Write-Host "Granting IAM roles to service account..." -ForegroundColor Cyan
$roles = @(
    "roles/cloudbuild.builds.builder",
    "roles/run.admin",
    "roles/storage.admin",
    "roles/artifactregistry.admin",
    "roles/secretmanager.admin",
    "roles/iam.serviceAccountUser"
)

foreach ($role in $roles) {
    Write-Host "  Granting $role..." -ForegroundColor Gray
    gcloud projects add-iam-policy-binding $PROJECT_ID `
        --member="serviceAccount:$saEmail" `
        --role="$role" `
        --quiet 2>$null | Out-Null
}

# Create Artifact Registry repository
Write-Host "Creating Artifact Registry repository..." -ForegroundColor Cyan
gcloud artifacts repositories create bland-images `
    --repository-format=docker `
    --location=$REGION `
    --description="Docker images for Bland AI application" 2>$null

# Grant Cloud Build permissions
Write-Host "Granting Cloud Build service account permissions..." -ForegroundColor Cyan
$projectNumber = (gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
$cloudBuildSA = "${projectNumber}@cloudbuild.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID `
    --member="serviceAccount:$cloudBuildSA" `
    --role="roles/run.admin" `
    --quiet 2>$null | Out-Null

gcloud projects add-iam-policy-binding $PROJECT_ID `
    --member="serviceAccount:$cloudBuildSA" `
    --role="roles/iam.serviceAccountUser" `
    --quiet 2>$null | Out-Null

# Create service account key for GitHub Actions
Write-Host "Creating service account key for GitHub Actions..." -ForegroundColor Cyan
$keyFile = "sa-key.json"
gcloud iam service-accounts keys create $keyFile `
    --iam-account=$saEmail

# Convert to base64
$keyContent = Get-Content $keyFile -Raw
$base64Key = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($keyContent))
$base64Key | Out-File -FilePath "sa-key-base64.txt" -NoNewline

# Create Secret Manager secrets
Write-Host "Creating Secret Manager secrets..." -ForegroundColor Cyan
$secrets = @(
    "bland-api-key",
    "database-url",
    "redis-url",
    "jwt-secret",
    "encryption-key"
)

foreach ($secret in $secrets) {
    Write-Host "  Creating secret: $secret" -ForegroundColor Gray
    "PLACEHOLDER" | gcloud secrets create $secret --data-file=- 2>$null
}

Write-Host "`n" -NoNewline
Write-Host ("=" * 80) -ForegroundColor Green
Write-Host "GCP PROJECT SETUP COMPLETE!" -ForegroundColor Green
Write-Host ("=" * 80) -ForegroundColor Green

Write-Host "`nProject Details:" -ForegroundColor Yellow
Write-Host "  Project ID: $PROJECT_ID" -ForegroundColor Cyan
Write-Host "  Region: $REGION" -ForegroundColor Cyan
Write-Host "  Service Account: $saEmail" -ForegroundColor Cyan

Write-Host "`nIMPORTANT FILES CREATED:" -ForegroundColor Yellow
Write-Host "  sa-key.json - Service account key (DO NOT COMMIT)" -ForegroundColor Red
Write-Host "  sa-key-base64.txt - Base64 encoded key for GitHub Secrets" -ForegroundColor Cyan

Write-Host "`nNEXT STEPS:" -ForegroundColor Yellow
Write-Host "1. Add the service account key to GitHub Secrets:" -ForegroundColor White
Write-Host "   - Go to: https://github.com/$GITHUB_OWNER/$GITHUB_REPO/settings/secrets/actions" -ForegroundColor Gray
Write-Host "   - Click 'New repository secret'" -ForegroundColor Gray
Write-Host "   - Name: GCP_SA_KEY" -ForegroundColor Gray
Write-Host "   - Value: Copy contents from sa-key-base64.txt" -ForegroundColor Gray

Write-Host "`n2. Connect Cloud Build to GitHub:" -ForegroundColor White
Write-Host "   - Go to: https://console.cloud.google.com/cloud-build/triggers/connect?project=$PROJECT_ID" -ForegroundColor Gray
Write-Host "   - Click 'Connect Repository'" -ForegroundColor Gray
Write-Host "   - Select 'GitHub (Cloud Build GitHub App)'" -ForegroundColor Gray
Write-Host "   - Authenticate and select repository: $GITHUB_REPO" -ForegroundColor Gray

Write-Host "`n3. Update Secret Manager secrets with actual values:" -ForegroundColor White
Write-Host "   Example:" -ForegroundColor Gray
Write-Host '   echo -n "your-api-key" | gcloud secrets versions add bland-api-key --data-file=-' -ForegroundColor Gray

Write-Host "`n4. Create Cloud Build trigger after connecting GitHub:" -ForegroundColor White
Write-Host "   gcloud builds triggers create github ``" -ForegroundColor Gray
Write-Host "     --repo-name=$GITHUB_REPO ``" -ForegroundColor Gray
Write-Host "     --repo-owner=$GITHUB_OWNER ``" -ForegroundColor Gray
Write-Host "     --branch-pattern='^main$' ``" -ForegroundColor Gray
Write-Host "     --build-config=cloudbuild.yaml ``" -ForegroundColor Gray
Write-Host "     --name=deploy-main" -ForegroundColor Gray

Write-Host "`nSECURITY REMINDER:" -ForegroundColor Red
Write-Host "After adding the key to GitHub, delete local key files:" -ForegroundColor Yellow
Write-Host "  Remove-Item sa-key.json" -ForegroundColor Gray
Write-Host "  Remove-Item sa-key-base64.txt" -ForegroundColor Gray

Write-Host "`n" -NoNewline
