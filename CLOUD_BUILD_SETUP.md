# Cloud Build GitHub Integration Setup Guide

This guide walks you through connecting Google Cloud Build to your GitHub repository `bland-gcp-migration` using OAuth authentication.

## Prerequisites

- GCP Project: `bland-gcp-migration` (or your custom project ID)
- GitHub Repository: `bland-gcp-migration`
- Required permissions:
  - GCP: Project Owner or Cloud Build Admin
  - GitHub: Repository Admin access

## Step 1: Initial GCP Setup

First, run the setup script to configure your GCP project:

```bash
# Make the script executable
chmod +x infrastructure/setup-gcp.sh

# Set required environment variables
export PROJECT_ID="bland-gcp-migration"
export BILLING_ACCOUNT_ID="YOUR_BILLING_ACCOUNT_ID"
export REGION="us-central1"
export GITHUB_OWNER="YOUR_GITHUB_USERNAME_OR_ORG"

# Run the setup script
./infrastructure/setup-gcp.sh
```

## Step 2: Connect Cloud Build to GitHub

### Option A: Using GCP Console (Recommended)

1. **Navigate to Cloud Build Triggers**
   ```
   https://console.cloud.google.com/cloud-build/triggers/connect?project=bland-gcp-migration
   ```

2. **Start Connection Process**
   - Click **"Connect Repository"**
   - Select **"GitHub (Cloud Build GitHub App)"**

3. **Authenticate with GitHub**
   - Click **"Authorize Google Cloud Build"**
   - Sign in to your GitHub account if prompted
   - Review and accept the permissions

4. **Select Repository**
   - Choose your GitHub account or organization
   - Select the repository: `bland-gcp-migration`
   - Click **"Connect"**

5. **Confirm Connection**
   - Review the connection details
   - Click **"Done"**

### Option B: Using gcloud CLI

1. **Install GitHub App**
   First, visit: https://github.com/apps/google-cloud-build
   - Click **"Install"** or **"Configure"**
   - Select your GitHub account/organization
   - Choose **"Only select repositories"**
   - Select `bland-gcp-migration`
   - Click **"Install"**

2. **Create Connection**
   ```bash
   # Create the GitHub connection
   gcloud builds connections create github bland-github-connection \
     --region=us-central1
   ```

3. **Link Repository**
   ```bash
   # Link your repository
   gcloud builds repositories create bland-gcp-migration \
     --remote-uri=https://github.com/YOUR_GITHUB_OWNER/bland-gcp-migration.git \
     --connection=bland-github-connection \
     --region=us-central1
   ```

## Step 3: Create Build Triggers

After connecting your repository, create build triggers:

### Create Main Branch Trigger
```bash
gcloud builds triggers create github \
  --repo-name=bland-gcp-migration \
  --repo-owner=YOUR_GITHUB_OWNER \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml \
  --name=deploy-main \
  --description="Deploy main branch to production"
```

### Create Staging Branch Trigger
```bash
gcloud builds triggers create github \
  --repo-name=bland-gcp-migration \
  --repo-owner=YOUR_GITHUB_OWNER \
  --branch-pattern="^staging$" \
  --build-config=cloudbuild.yaml \
  --name=deploy-staging \
  --description="Deploy staging branch"
```

### Create Pull Request Trigger
```bash
gcloud builds triggers create github \
  --repo-name=bland-gcp-migration \
  --repo-owner=YOUR_GITHUB_OWNER \
  --pull-request-pattern="^.*" \
  --build-config=cloudbuild.yaml \
  --name=pr-validation \
  --description="Validate pull requests" \
  --comment-control=COMMENTS_ENABLED_FOR_EXTERNAL_CONTRIBUTORS_ONLY
```

## Step 4: Configure GitHub Actions

1. **Create Service Account Key**
   ```bash
   # This was already done by setup-gcp.sh
   # The key file is: sa-key.json
   ```

2. **Add Secret to GitHub**
   - Go to: `https://github.com/YOUR_GITHUB_OWNER/bland-gcp-migration/settings/secrets/actions`
   - Click **"New repository secret"**
   - Name: `GCP_SA_KEY`
   - Value: Paste the base64-encoded content of `sa-key.json`
   
   ```bash
   # Copy to clipboard (Mac)
   base64 sa-key.json | pbcopy
   
   # Copy to clipboard (Linux)
   base64 sa-key.json | xclip -selection clipboard
   
   # Or just display it
   base64 sa-key.json
   ```

3. **Add Additional Secrets** (Optional)
   Add these if you want Slack notifications:
   - `SLACK_WEBHOOK_URL`: Your Slack webhook URL

## Step 5: Configure Secret Manager

Add your application secrets to Google Secret Manager:

```bash
# Add Bland API Key
echo -n "your-bland-api-key" | gcloud secrets versions add bland-api-key --data-file=-

# Add Database URL
echo -n "postgresql://user:pass@host/db" | gcloud secrets versions add database-url --data-file=-

# Add Redis URL
echo -n "redis://host:6379" | gcloud secrets versions add redis-url --data-file=-

# Add JWT Secret
echo -n "your-jwt-secret-key" | gcloud secrets versions add jwt-secret --data-file=-

# Add Encryption Key
echo -n "your-encryption-key" | gcloud secrets versions add encryption-key --data-file=-
```

## Step 6: Test the Integration

### Test Cloud Build Trigger
```bash
# Manually trigger a build
gcloud builds triggers run deploy-main \
  --branch=main \
  --repo-name=bland-gcp-migration \
  --repo-owner=YOUR_GITHUB_OWNER
```

### Test GitHub Actions
```bash
# Push to a branch to trigger the workflow
git add .
git commit -m "Test CI/CD pipeline"
git push origin main
```

## Step 7: Monitor Builds

### View Cloud Build History
```bash
# List recent builds
gcloud builds list --limit=5

# View specific build logs
gcloud builds log BUILD_ID
```

### Cloud Build Console
Visit: https://console.cloud.google.com/cloud-build/builds?project=bland-gcp-migration

### GitHub Actions
Visit: https://github.com/YOUR_GITHUB_OWNER/bland-gcp-migration/actions

## Troubleshooting

### Common Issues

1. **Permission Denied**
   ```bash
   # Ensure Cloud Build service account has necessary permissions
   PROJECT_NUMBER=$(gcloud projects describe bland-gcp-migration --format="value(projectNumber)")
   gcloud projects add-iam-policy-binding bland-gcp-migration \
     --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
     --role="roles/run.admin"
   ```

2. **GitHub App Not Installed**
   - Visit: https://github.com/apps/google-cloud-build
   - Ensure the app is installed for your repository

3. **Trigger Not Firing**
   - Check webhook delivery: GitHub repo → Settings → Webhooks
   - Verify branch patterns match your branch names
   - Check Cloud Build trigger logs

4. **Secret Access Issues**
   ```bash
   # Grant Cloud Build access to secrets
   PROJECT_NUMBER=$(gcloud projects describe bland-gcp-migration --format="value(projectNumber)")
   gcloud secrets add-iam-policy-binding bland-api-key \
     --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```

## Security Best Practices

1. **Service Account Keys**
   - Rotate keys regularly
   - Use Workload Identity when possible
   - Never commit keys to repository

2. **Secrets Management**
   - Use Secret Manager for all sensitive data
   - Implement secret rotation
   - Audit secret access regularly

3. **Build Security**
   - Enable vulnerability scanning
   - Use minimal base images
   - Scan dependencies for vulnerabilities

4. **Network Security**
   - Use VPC Service Controls
   - Implement private IP ranges
   - Enable Cloud Armor for DDoS protection

## Next Steps

1. **Set up monitoring**
   ```bash
   # Create alerting policy for build failures
   gcloud alpha monitoring policies create \
     --notification-channels=YOUR_CHANNEL_ID \
     --display-name="Build Failure Alert" \
     --condition-display-name="Build Failed" \
     --condition-expression='resource.type="cloud_build" AND metric.type="cloudbuild.googleapis.com/build/count" AND metric.label.status="FAILURE"'
   ```

2. **Configure deployment environments**
   - Set up separate projects for dev/staging/prod
   - Implement environment-specific configurations
   - Set up approval gates for production

3. **Implement rollback strategy**
   - Configure Cloud Run revision management
   - Set up automated rollback on failures
   - Implement canary deployments

## Additional Resources

- [Cloud Build Documentation](https://cloud.google.com/build/docs)
- [GitHub Actions with GCP](https://cloud.google.com/blog/products/devops-sre/using-github-actions-with-google-cloud)
- [Cloud Run Best Practices](https://cloud.google.com/run/docs/best-practices)
- [Secret Manager Guide](https://cloud.google.com/secret-manager/docs)

## Support

For issues or questions:
1. Check Cloud Build logs: `gcloud builds log BUILD_ID`
2. Review GitHub webhook deliveries
3. Check service account permissions
4. Review Secret Manager access logs

Remember to clean up the service account key file after adding it to GitHub:
```bash
rm sa-key.json
```
