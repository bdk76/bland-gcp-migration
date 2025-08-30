# GCP Project Setup Script for Windows PowerShell
# This script sets up a new GCP project with all necessary services and configurations
# for the Bland AI migration project

# Set error action preference
$ErrorActionPreference = "Stop"

# Configuration variables
$PROJECT_ID = if ($env:PROJECT_ID) { $env:PROJECT_ID } else { "bland-gcp-migration" }
$PROJECT_NAME = if ($env:PROJECT_NAME) { $env:PROJECT_NAME } else { "Bland GCP Migration" }
$BILLING_ACCOUNT_ID = $env:BILLING_ACCOUNT_ID
$REGION = if ($env:REGION) { $env:REGION } else { "us-central1" }
$ZONE = if ($env:ZONE) { $env:ZONE } else { "us-central1-a" }
$SERVICE_ACCOUNT_NAME = "bland-service-account"
$GITHUB_REPO = "bland-gcp-migration"
$GITHUB_OWNER = $env:GITHUB_OWNER

# Color functions for output
function Write-Status {
    param($Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Error-Message {
    param($Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-Warning-Message {
    param($Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

# Check if gcloud is installed
Write-Status "Checking for gcloud CLI installation..."
$gcloudPath = where.exe gcloud 2>$null
if ($gcloudPath) {
    Write-Status "gcloud CLI found at: $($gcloudPath[0])"
    $gcloudVersion = gcloud version 2>$null | Select-String "Google Cloud SDK" | ForEach-Object { $_.Line }
    Write-Status "Version: $gcloudVersion"
} else {
    Write-Error-Message "gcloud CLI is not installed or not in PATH."
    Write-Host "Please install it from: https://cloud.google.com/sdk/docs/install"
    Write-Host ""
    Write-Host "For Windows, you can:"
    Write-Host "1. Download the installer from the link above"
    Write-Host "2. Or use PowerShell: (New-Object Net.WebClient).DownloadFile('https://dl.google.com/dl/cloudsdk/channels/rapid/GoogleCloudSDKInstaller.exe', '$env:TEMP\GoogleCloudSDKInstaller.exe'); Start-Process -FilePath '$env:TEMP\GoogleCloudSDKInstaller.exe' -Wait"
    exit 1
}

Write-Status "Starting GCP project setup for: $PROJECT_ID"

# 1. Create new GCP project
Write-Status "Creating GCP project..."
$projectExists = gcloud projects describe $PROJECT_ID 2>$null
if ($projectExists) {
    Write-Warning-Message "Project $PROJECT_ID already exists. Skipping creation."
} else {
    gcloud projects create $PROJECT_ID --name="$PROJECT_NAME" --set-as-default
    Write-Status "Project $PROJECT_ID created successfully."
}

# Set the project as default
gcloud config set project $PROJECT_ID

# 2. Link billing account
if (-not $BILLING_ACCOUNT_ID) {
    Write-Warning-Message "BILLING_ACCOUNT_ID not set. Listing available billing accounts..."
    gcloud billing accounts list
    Write-Host ""
    Write-Host "Please set BILLING_ACCOUNT_ID environment variable and re-run the script:"
    Write-Host '  $env:BILLING_ACCOUNT_ID = "YOUR_BILLING_ACCOUNT_ID"'
    Write-Host "  Then run this script again"
    exit 1
} else {
    Write-Status "Linking billing account..."
    gcloud billing projects link $PROJECT_ID --billing-account=$BILLING_ACCOUNT_ID
}

# 3. Enable required APIs
Write-Status "Enabling required GCP APIs..."
$apis = @(
    "cloudbuild.googleapis.com",
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "containerregistry.googleapis.com",
    "compute.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudkms.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "pubsub.googleapis.com",
    "redis.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "servicenetworking.googleapis.com",
    "vpcaccess.googleapis.com"
)

foreach ($api in $apis) {
    Write-Status "Enabling $api..."
    gcloud services enable $api --project=$PROJECT_ID
}

# 4. Set default region and zone
Write-Status "Setting default region ($REGION) and zone ($ZONE)..."
gcloud config set compute/region $REGION
gcloud config set compute/zone $ZONE

# 5. Create service account for deployments
Write-Status "Creating service account..."
$saEmail = "${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
$saExists = gcloud iam service-accounts describe $saEmail 2>$null
if ($saExists) {
    Write-Warning-Message "Service account already exists. Skipping creation."
} else {
    gcloud iam service-accounts create $SERVICE_ACCOUNT_NAME `
        --display-name="Bland Service Account" `
        --description="Service account for Bland AI application"
}

# 6. Grant necessary roles to service account
Write-Status "Granting IAM roles to service account..."
$roles = @(
    "roles/cloudbuild.builds.builder",
    "roles/run.admin",
    "roles/storage.admin",
    "roles/artifactregistry.admin",
    "roles/secretmanager.admin",
    "roles/cloudkms.admin",
    "roles/pubsub.admin",
    "roles/redis.admin",
    "roles/cloudsql.admin",
    "roles/compute.networkAdmin",
    "roles/vpcaccess.admin",
    "roles/iam.serviceAccountUser"
)

foreach ($role in $roles) {
    Write-Status "Granting $role..."
    gcloud projects add-iam-policy-binding $PROJECT_ID `
        --member="serviceAccount:$saEmail" `
        --role="$role" `
        --quiet
}

# 7. Create Artifact Registry repository
Write-Status "Creating Artifact Registry repository..."
$repoExists = gcloud artifacts repositories describe bland-images --location=$REGION 2>$null
if ($repoExists) {
    Write-Warning-Message "Artifact Registry repository already exists. Skipping creation."
} else {
    gcloud artifacts repositories create bland-images `
        --repository-format=docker `
        --location=$REGION `
        --description="Docker images for Bland AI application"
}

# 8. Create Cloud Storage buckets
Write-Status "Creating Cloud Storage buckets..."
$buckets = @(
    "${PROJECT_ID}-terraform-state",
    "${PROJECT_ID}-backups",
    "${PROJECT_ID}-media"
)

foreach ($bucket in $buckets) {
    $bucketExists = gsutil ls -b "gs://$bucket" 2>$null
    if ($bucketExists) {
        Write-Warning-Message "Bucket gs://$bucket already exists. Skipping."
    } else {
        Write-Status "Creating bucket gs://$bucket..."
        gsutil mb -p $PROJECT_ID -l $REGION "gs://$bucket"
        
        # Enable versioning for terraform state bucket
        if ($bucket -like "*terraform-state*") {
            gsutil versioning set on "gs://$bucket"
        }
    }
}

# 9. Grant Cloud Build permissions
Write-Status "Granting Cloud Build service account necessary permissions..."
$projectNumber = (gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
$cloudBuildSA = "${projectNumber}@cloudbuild.gserviceaccount.com"

# Grant necessary roles to Cloud Build service account
$cloudBuildRoles = @(
    "roles/run.admin",
    "roles/iam.serviceAccountUser",
    "roles/artifactregistry.writer"
)

foreach ($role in $cloudBuildRoles) {
    gcloud projects add-iam-policy-binding $PROJECT_ID `
        --member="serviceAccount:$cloudBuildSA" `
        --role="$role" `
        --quiet
}

# 10. Create VPC network for private resources
Write-Status "Creating VPC network..."
$networkExists = gcloud compute networks describe bland-network 2>$null
if ($networkExists) {
    Write-Warning-Message "VPC network already exists. Skipping creation."
} else {
    gcloud compute networks create bland-network `
        --subnet-mode=auto `
        --bgp-routing-mode=regional
}

# 11. Create firewall rules
Write-Status "Creating firewall rules..."
$firewallExists = gcloud compute firewall-rules describe allow-internal 2>$null
if ($firewallExists) {
    Write-Warning-Message "Firewall rules already exist. Skipping."
} else {
    # Allow internal communication
    gcloud compute firewall-rules create allow-internal `
        --network=bland-network `
        --allow=tcp,udp,icmp `
        --source-ranges=10.0.0.0/8
    
    # Allow health checks
    gcloud compute firewall-rules create allow-health-checks `
        --network=bland-network `
        --allow=tcp `
        --source-ranges=35.191.0.0/16,130.211.0.0/22
}

# 12. Create service account key for GitHub Actions
Write-Status "Creating service account key for GitHub Actions..."
$keyFile = "sa-key.json"
gcloud iam service-accounts keys create $keyFile `
    --iam-account=$saEmail

Write-Status "Service account key created: $keyFile"
Write-Warning-Message "IMPORTANT: Store this key securely and add it to GitHub Secrets as GCP_SA_KEY"

# Convert to base64 for easy copying
$keyContent = Get-Content $keyFile -Raw
$base64Key = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($keyContent))
$base64KeyFile = "sa-key-base64.txt"
$base64Key | Out-File -FilePath $base64KeyFile -NoNewline

Write-Host ""
Write-Host "The base64-encoded key has been saved to: $base64KeyFile" -ForegroundColor Cyan
Write-Host "Copy the contents of this file and add it to your GitHub repository secrets as GCP_SA_KEY" -ForegroundColor Cyan
Write-Host ""

# 13. Setup Cloud Build trigger (requires manual OAuth connection first)
Write-Status "Cloud Build GitHub connection setup:"
Write-Host ""
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host "MANUAL STEPS REQUIRED - Cloud Build GitHub Connection:" -ForegroundColor Yellow
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Go to: https://console.cloud.google.com/cloud-build/triggers/connect?project=$PROJECT_ID"
Write-Host ""
Write-Host "2. Click 'Connect Repository'"
Write-Host ""
Write-Host "3. Select 'GitHub (Cloud Build GitHub App)'"
Write-Host ""
Write-Host "4. Authenticate with GitHub if prompted"
Write-Host ""
Write-Host "5. Select your GitHub account/organization: $GITHUB_OWNER"
Write-Host ""
Write-Host "6. Select repository: $GITHUB_REPO"
Write-Host ""
Write-Host "7. Click 'Connect' and then 'Done'"
Write-Host ""
Write-Host "8. After connecting, run this command to create the trigger:"
Write-Host ""
Write-Host "   gcloud builds triggers create github ``" -ForegroundColor Yellow
Write-Host "     --repo-name=$GITHUB_REPO ``" -ForegroundColor Yellow
Write-Host "     --repo-owner=$GITHUB_OWNER ``" -ForegroundColor Yellow
Write-Host "     --branch-pattern='^main$' ``" -ForegroundColor Yellow
Write-Host "     --build-config=cloudbuild.yaml ``" -ForegroundColor Yellow
Write-Host "     --name=deploy-main" -ForegroundColor Yellow
Write-Host ""
Write-Host ("=" * 80) -ForegroundColor Cyan

# 14. Create Secret Manager secrets placeholders
Write-Status "Creating Secret Manager secret placeholders..."
$secrets = @(
    "bland-api-key",
    "database-url",
    "redis-url",
    "jwt-secret",
    "encryption-key"
)

foreach ($secret in $secrets) {
    $secretExists = gcloud secrets describe $secret 2>$null
    if ($secretExists) {
        Write-Warning-Message "Secret $secret already exists. Skipping."
    } else {
        Write-Status "Creating secret $secret..."
        "PLACEHOLDER" | gcloud secrets create $secret --data-file=-
        Write-Warning-Message "Remember to update $secret with actual value"
    }
}

# Summary
Write-Host ""
Write-Host ("=" * 80) -ForegroundColor Green
Write-Status "GCP Project Setup Complete!"
Write-Host ("=" * 80) -ForegroundColor Green
Write-Host ""
Write-Host "Project ID: $PROJECT_ID" -ForegroundColor Cyan
Write-Host "Region: $REGION" -ForegroundColor Cyan
Write-Host "Service Account: $saEmail" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Add the service account key to GitHub Secrets as GCP_SA_KEY"
Write-Host "   - The base64-encoded key is in: sa-key-base64.txt"
Write-Host "2. Connect Cloud Build to GitHub (follow instructions above)"
Write-Host "3. Update Secret Manager secrets with actual values"
Write-Host "4. Configure your application environment variables"
Write-Host "5. Push your code to trigger the CI/CD pipeline"
Write-Host ""
Write-Host "Useful commands:" -ForegroundColor Yellow
Write-Host "  View project: gcloud projects describe $PROJECT_ID"
Write-Host "  List services: gcloud services list --enabled"
Write-Host "  View logs: gcloud logging read"
Write-Host "  View builds: gcloud builds list"
Write-Host ""
Write-Status "Setup script completed successfully!"

# Reminder about cleanup
Write-Host ""
Write-Warning-Message "Security reminder: After adding the key to GitHub, delete the local key files:"
Write-Host "  Remove-Item sa-key.json" -ForegroundColor Yellow
Write-Host "  Remove-Item sa-key-base64.txt" -ForegroundColor Yellow
