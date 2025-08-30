#!/bin/bash

# GCP Project Setup Script
# This script sets up a new GCP project with all necessary services and configurations
# for the Bland AI migration project

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration variables
PROJECT_ID="${PROJECT_ID:-bland-gcp-migration}"
PROJECT_NAME="${PROJECT_NAME:-Bland GCP Migration}"
BILLING_ACCOUNT_ID="${BILLING_ACCOUNT_ID}"
REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
SERVICE_ACCOUNT_NAME="bland-service-account"
GITHUB_REPO="bland-gcp-migration"
GITHUB_OWNER="${GITHUB_OWNER}"

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    print_error "gcloud CLI is not installed. Please install it first."
    echo "Visit: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

print_status "Starting GCP project setup for: $PROJECT_ID"

# 1. Create new GCP project
print_status "Creating GCP project..."
if gcloud projects describe $PROJECT_ID &>/dev/null; then
    print_warning "Project $PROJECT_ID already exists. Skipping creation."
else
    gcloud projects create $PROJECT_ID --name="$PROJECT_NAME" --set-as-default
    print_status "Project $PROJECT_ID created successfully."
fi

# Set the project as default
gcloud config set project $PROJECT_ID

# 2. Link billing account
if [ -z "$BILLING_ACCOUNT_ID" ]; then
    print_warning "BILLING_ACCOUNT_ID not set. Listing available billing accounts..."
    gcloud billing accounts list
    echo "Please set BILLING_ACCOUNT_ID and re-run the script."
    exit 1
else
    print_status "Linking billing account..."
    gcloud billing projects link $PROJECT_ID --billing-account=$BILLING_ACCOUNT_ID
fi

# 3. Enable required APIs
print_status "Enabling required GCP APIs..."
APIS=(
    "cloudbuild.googleapis.com"
    "run.googleapis.com"
    "artifactregistry.googleapis.com"
    "containerregistry.googleapis.com"
    "compute.googleapis.com"
    "cloudresourcemanager.googleapis.com"
    "iam.googleapis.com"
    "secretmanager.googleapis.com"
    "cloudkms.googleapis.com"
    "logging.googleapis.com"
    "monitoring.googleapis.com"
    "pubsub.googleapis.com"
    "redis.googleapis.com"
    "sqladmin.googleapis.com"
    "storage.googleapis.com"
    "servicenetworking.googleapis.com"
    "vpcaccess.googleapis.com"
)

for api in "${APIS[@]}"; do
    print_status "Enabling $api..."
    gcloud services enable $api --project=$PROJECT_ID
done

# 4. Set default region and zone
print_status "Setting default region ($REGION) and zone ($ZONE)..."
gcloud config set compute/region $REGION
gcloud config set compute/zone $ZONE

# 5. Create service account for deployments
print_status "Creating service account..."
if gcloud iam service-accounts describe ${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com &>/dev/null; then
    print_warning "Service account already exists. Skipping creation."
else
    gcloud iam service-accounts create $SERVICE_ACCOUNT_NAME \
        --display-name="Bland Service Account" \
        --description="Service account for Bland AI application"
fi

# 6. Grant necessary roles to service account
print_status "Granting IAM roles to service account..."
ROLES=(
    "roles/cloudbuild.builds.builder"
    "roles/run.admin"
    "roles/storage.admin"
    "roles/artifactregistry.admin"
    "roles/secretmanager.admin"
    "roles/cloudkms.admin"
    "roles/pubsub.admin"
    "roles/redis.admin"
    "roles/cloudsql.admin"
    "roles/compute.networkAdmin"
    "roles/vpcaccess.admin"
    "roles/iam.serviceAccountUser"
)

for role in "${ROLES[@]}"; do
    print_status "Granting $role..."
    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
        --role="$role" \
        --quiet
done

# 7. Create Artifact Registry repository
print_status "Creating Artifact Registry repository..."
if gcloud artifacts repositories describe bland-images --location=$REGION &>/dev/null; then
    print_warning "Artifact Registry repository already exists. Skipping creation."
else
    gcloud artifacts repositories create bland-images \
        --repository-format=docker \
        --location=$REGION \
        --description="Docker images for Bland AI application"
fi

# 8. Create Cloud Storage buckets
print_status "Creating Cloud Storage buckets..."
BUCKETS=(
    "${PROJECT_ID}-terraform-state"
    "${PROJECT_ID}-backups"
    "${PROJECT_ID}-media"
)

for bucket in "${BUCKETS[@]}"; do
    if gsutil ls -b gs://$bucket &>/dev/null; then
        print_warning "Bucket gs://$bucket already exists. Skipping."
    else
        print_status "Creating bucket gs://$bucket..."
        gsutil mb -p $PROJECT_ID -l $REGION gs://$bucket
        
        # Enable versioning for terraform state bucket
        if [[ $bucket == *"terraform-state"* ]]; then
            gsutil versioning set on gs://$bucket
        fi
    fi
done

# 9. Grant Cloud Build permissions
print_status "Granting Cloud Build service account necessary permissions..."
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
CLOUD_BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

# Grant Cloud Run Admin role
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${CLOUD_BUILD_SA}" \
    --role="roles/run.admin"

# Grant Service Account User role
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${CLOUD_BUILD_SA}" \
    --role="roles/iam.serviceAccountUser"

# Grant Artifact Registry Writer role
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${CLOUD_BUILD_SA}" \
    --role="roles/artifactregistry.writer"

# 10. Create VPC network for private resources
print_status "Creating VPC network..."
if gcloud compute networks describe bland-network &>/dev/null; then
    print_warning "VPC network already exists. Skipping creation."
else
    gcloud compute networks create bland-network \
        --subnet-mode=auto \
        --bgp-routing-mode=regional
fi

# 11. Create firewall rules
print_status "Creating firewall rules..."
if gcloud compute firewall-rules describe allow-internal &>/dev/null; then
    print_warning "Firewall rules already exist. Skipping."
else
    # Allow internal communication
    gcloud compute firewall-rules create allow-internal \
        --network=bland-network \
        --allow=tcp,udp,icmp \
        --source-ranges=10.0.0.0/8
    
    # Allow health checks
    gcloud compute firewall-rules create allow-health-checks \
        --network=bland-network \
        --allow=tcp \
        --source-ranges=35.191.0.0/16,130.211.0.0/22
fi

# 12. Create service account key for GitHub Actions
print_status "Creating service account key for GitHub Actions..."
KEY_FILE="sa-key.json"
gcloud iam service-accounts keys create $KEY_FILE \
    --iam-account=${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com

print_status "Service account key created: $KEY_FILE"
print_warning "IMPORTANT: Store this key securely and add it to GitHub Secrets as GCP_SA_KEY"
print_warning "Run: base64 $KEY_FILE | pbcopy (on Mac) or base64 $KEY_FILE | xclip -selection clipboard (on Linux)"
print_warning "Then add it to your GitHub repository secrets"

# 13. Setup Cloud Build trigger (requires manual OAuth connection first)
print_status "Cloud Build GitHub connection setup:"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "MANUAL STEPS REQUIRED - Cloud Build GitHub Connection:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Go to: https://console.cloud.google.com/cloud-build/triggers/connect?project=$PROJECT_ID"
echo ""
echo "2. Click 'Connect Repository'"
echo ""
echo "3. Select 'GitHub (Cloud Build GitHub App)'"
echo ""
echo "4. Authenticate with GitHub if prompted"
echo ""
echo "5. Select your GitHub account/organization: $GITHUB_OWNER"
echo ""
echo "6. Select repository: $GITHUB_REPO"
echo ""
echo "7. Click 'Connect' and then 'Done'"
echo ""
echo "8. After connecting, run this command to create the trigger:"
echo ""
echo "   gcloud builds triggers create github \\"
echo "     --repo-name=$GITHUB_REPO \\"
echo "     --repo-owner=$GITHUB_OWNER \\"
echo "     --branch-pattern='^main$' \\"
echo "     --build-config=cloudbuild.yaml \\"
echo "     --name=deploy-main"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 14. Create Secret Manager secrets placeholders
print_status "Creating Secret Manager secret placeholders..."
SECRETS=(
    "bland-api-key"
    "database-url"
    "redis-url"
    "jwt-secret"
    "encryption-key"
)

for secret in "${SECRETS[@]}"; do
    if gcloud secrets describe $secret &>/dev/null; then
        print_warning "Secret $secret already exists. Skipping."
    else
        print_status "Creating secret $secret..."
        echo "PLACEHOLDER" | gcloud secrets create $secret --data-file=-
        print_warning "Remember to update $secret with actual value"
    fi
done

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
print_status "GCP Project Setup Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo "Service Account: ${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
echo ""
echo "Next Steps:"
echo "1. Add the service account key to GitHub Secrets as GCP_SA_KEY"
echo "2. Connect Cloud Build to GitHub (follow instructions above)"
echo "3. Update Secret Manager secrets with actual values"
echo "4. Configure your application environment variables"
echo "5. Push your code to trigger the CI/CD pipeline"
echo ""
echo "Useful commands:"
echo "  View project: gcloud projects describe $PROJECT_ID"
echo "  List services: gcloud services list --enabled"
echo "  View logs: gcloud logging read"
echo "  View builds: gcloud builds list"
echo ""
print_status "Setup script completed successfully!"
