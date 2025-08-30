# Environment Configuration Guide

## Current Setup (What You Have Now)
Your services are deployed to Cloud Run and work WITHOUT .env files. This is actually GOOD!

## Why You DON'T Need .env Files

### 1. Security Risk
- .env files can accidentally be committed to Git
- They contain sensitive information
- Cloud Run has better ways to handle this

### 2. Cloud Run Provides These Automatically
```javascript
// These are automatically available in Cloud Run:
process.env.PORT              // 8080
process.env.K_SERVICE         // Service name
process.env.K_REVISION        // Revision name
process.env.K_CONFIGURATION   // Configuration name
process.env.GOOGLE_CLOUD_PROJECT // Your project ID
```

### 3. Your Services Don't Use Them
Your services currently use:
- Hardcoded Firestore initialization (uses default project)
- Hardcoded cache TTL (300 seconds)
- Hardcoded PubSub (uses default project)

## If You Want Configuration (Optional)

### Option 1: Use GitHub Actions to Set Variables
Edit `.github/workflows/deploy.yml`:
```yaml
--set-env-vars="NODE_ENV=production,CACHE_TTL=300,ENABLE_METRICS=true"
```

### Option 2: Use Secret Manager for Sensitive Data
```bash
# Create a secret
echo -n "your-api-key" | gcloud secrets create bland-api-key --data-file=-

# Reference in deployment
--set-secrets="BLAND_API_KEY=bland-api-key:latest"
```

### Option 3: For Local Development Only
Create `.env` for local testing (NEVER commit):
```bash
# .env (add to .gitignore!)
NODE_ENV=development
PORT=3001
PROJECT_ID=bland-gcp-migration
```

## What Your .env Had Wrong

1. **Wrong Project ID**
   - Had: `bland-ai-backend`
   - Should be: `bland-gcp-migration`

2. **Unused Variables**
   - `FIRESTORE_DATABASE` - Not used (defaults to "(default)")
   - `METRICS_TOPIC` - Hardcoded in code
   - `CACHE_TTL` - Hardcoded to 300
   - `MAX_RETRIES` - Not used anywhere

3. **Feature Flags Not Implemented**
   - `ENABLE_CACHE` - Cache always runs
   - `ENABLE_METRICS` - Metrics not implemented

## Recommendation

**DON'T create .env files for production!**

Instead:
1. ✅ Keep using Cloud Run's automatic variables
2. ✅ Use Secret Manager for sensitive data
3. ✅ Hardcode non-sensitive defaults
4. ✅ Only use .env for local development

## If You Really Want Configuration

Update your service code first:
```javascript
// services/availability/index.js
const CACHE_TTL = process.env.CACHE_TTL || 300;
const ENABLE_CACHE = process.env.ENABLE_CACHE !== 'false';
const PROJECT_ID = process.env.PROJECT_ID || 'bland-gcp-migration';

const cache = new NodeCache({ 
  stdTTL: parseInt(CACHE_TTL), 
  checkperiod: 60 
});
```

Then set in deployment:
```bash
gcloud run services update bland-api-production \
  --set-env-vars="CACHE_TTL=600,ENABLE_CACHE=true" \
  --region=us-central1
```

## Summary

Your current setup is actually BETTER without .env files:
- ✅ More secure
- ✅ Less complexity
- ✅ Cloud-native approach
- ✅ Already working perfectly

Only add configuration when you actually need to change values between environments!
