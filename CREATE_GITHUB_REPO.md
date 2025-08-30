# Create GitHub Repository and Push Code

## Step 1: Create Repository on GitHub

1. **Go to GitHub**: https://github.com/new
2. **Fill in the repository details**:
   - **Repository name**: `bland-gcp-migration`
   - **Description**: "Bland AI services migration to Google Cloud Platform"
   - **Visibility**: Choose Public or Private (your preference)
   - **DO NOT** initialize with README, .gitignore, or license (we already have these locally)
3. **Click "Create repository"**

## Step 2: Push Your Local Code to GitHub

After creating the repository, GitHub will show you commands. Run these in PowerShell:

```powershell
# Add the remote repository (replace bdk76 with your username if different)
git remote add origin https://github.com/bdk76/bland-gcp-migration.git

# Rename branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

If you're using SSH instead of HTTPS:
```powershell
git remote add origin git@github.com:bdk76/bland-gcp-migration.git
git branch -M main
git push -u origin main
```

## Step 3: Verify Files Were Uploaded

After pushing, your repository should contain:
- `.github/workflows/deploy.yml` - GitHub Actions workflow
- `cloudbuild.yaml` - Cloud Build configuration
- `infrastructure/` - Setup scripts
- `services/` - Your microservices
- `.gitignore` - Git ignore rules
- Other configuration files

## Step 4: Add the GCP Service Account Key to GitHub Secrets

1. **Go to your repository settings**: 
   https://github.com/bdk76/bland-gcp-migration/settings/secrets/actions

2. **Click "New repository secret"**

3. **Add the secret**:
   - **Name**: `GCP_SA_KEY`
   - **Value**: Copy the entire contents of `sa-key-base64.txt` file

4. **Click "Add secret"**

## Step 5: Clean Up Sensitive Files

After adding the key to GitHub Secrets, remove the local key files:

```powershell
Remove-Item sa-key.json
Remove-Item sa-key-base64.txt
```

## Step 6: Connect Cloud Build to GitHub

1. **Go to Cloud Build triggers**:
   https://console.cloud.google.com/cloud-build/triggers/connect?project=bland-gcp-migration

2. **Follow the OAuth flow** to connect your repository

3. **Create a trigger** after connecting:
   ```powershell
   gcloud builds triggers create github `
     --repo-name=bland-gcp-migration `
     --repo-owner=bdk76 `
     --branch-pattern='^main$' `
     --build-config=cloudbuild.yaml `
     --name=deploy-main
   ```

## Troubleshooting

### If you get authentication errors when pushing:

**For HTTPS:**
- You'll need to use a Personal Access Token instead of your password
- Create one at: https://github.com/settings/tokens
- Use the token as your password when prompted

**For SSH:**
- Make sure your SSH key is added to GitHub: https://github.com/settings/keys
- Test connection: `ssh -T git@github.com`

### If the repository name is taken:
- Use a different name like `bland-ai-gcp-migration` or `bland-migration-gcp`
- Update the repository name in:
  - `.github/workflows/deploy.yml`
  - `cloudbuild.yaml`
  - Cloud Build trigger commands

## Next Steps

Once everything is set up:
1. Any push to the `main` branch will trigger the CI/CD pipeline
2. The application will be automatically deployed to Cloud Run
3. You can monitor builds at: https://console.cloud.google.com/cloud-build/builds?project=bland-gcp-migration
