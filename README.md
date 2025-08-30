# Bland GCP Migration

## Overview
This repository contains the Bland AI services migrated to Google Cloud Platform (GCP), with a focus on modern cloud-native architecture and automated CI/CD.

## Architecture

### Services
- **Main API Gateway** (`/`) - Express.js application routing to microservices
- **Availability Service** (`/services/availability`) - Calendar and scheduling management
- **Date Formatter** (`/services/date-formatter`) - Date formatting utilities
- **DOB Normalize** (`/services/dob-normalize`) - Date of birth normalization
- **Time Parser** (`/services/time-parser`) - Natural language time parsing
- **Zipcode Validate** (`/services/zipcode-validate`) - ZIP code validation service

### Infrastructure
- **Platform**: Google Cloud Platform (GCP)
- **Compute**: Cloud Run (serverless containers)
- **Registry**: Artifact Registry (Docker images)
- **Region**: us-central1

## CI/CD Pipeline

### 🚀 GitHub Actions (Primary Pipeline)
Our CI/CD is powered exclusively by GitHub Actions for simplicity and reliability.

**Workflow**: `.github/workflows/deploy.yml`

**Triggers**:
- Push to `main` → Production deployment
- Push to `staging` → Staging deployment (if configured)
- Push to `develop` → Development deployment (if configured)
- Pull requests → Run tests only

**Pipeline Steps**:
1. **Test & Lint** - Code quality checks
2. **Build** - Docker image creation
3. **Push** - Upload to Artifact Registry
4. **Deploy** - Deploy to Cloud Run
5. **Verify** - Health check validation

## Quick Start

### Prerequisites
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
- [Node.js 20+](https://nodejs.org/)
- [Docker](https://www.docker.com/get-started)

### Local Development
```bash
# Install dependencies
npm install

# Run locally
npm start

# Run tests
npm test
```

### Deployment
Deployments are automated via GitHub Actions:

```bash
# Deploy to production
git push origin main

# Check deployment status
gh run list --limit 5
```

### Manual Deployment (if needed)
```bash
# Authenticate with GCP
gcloud auth login
gcloud config set project bland-gcp-migration

# Build and push Docker image
docker build -t us-central1-docker.pkg.dev/bland-gcp-migration/bland-images/bland-api:latest .
docker push us-central1-docker.pkg.dev/bland-gcp-migration/bland-images/bland-api:latest

# Deploy to Cloud Run
gcloud run deploy bland-api-production \
  --image us-central1-docker.pkg.dev/bland-gcp-migration/bland-images/bland-api:latest \
  --region us-central1 \
  --platform managed
```

## Service URLs

### Production
- **API**: https://bland-api-production-333415133109.us-central1.run.app
- **Health Check**: `/health`
- **Status**: `/api/status`

### Authentication
Services require authentication by default. To access:

```bash
# Get auth token
TOKEN=$(gcloud auth print-identity-token)

# Make authenticated request
curl -H "Authorization: Bearer $TOKEN" \
  https://bland-api-production-333415133109.us-central1.run.app/health
```

## Monitoring

### Dashboards
- [Cloud Run Console](https://console.cloud.google.com/run?project=bland-gcp-migration)
- [GitHub Actions](https://github.com/bdk76/bland-gcp-migration/actions)
- [Cloud Monitoring](https://console.cloud.google.com/monitoring?project=bland-gcp-migration)

### Alerts
Monitoring and alerting configuration is available in `/monitoring`:
- `setup-monitoring.sh` - Automated monitoring setup
- `dashboard.json` - Custom dashboard configuration

## Project Structure

```
bland-gcp-migration/
├── .github/
│   └── workflows/
│       └── deploy.yml          # CI/CD pipeline
├── services/
│   ├── availability/           # Availability service
│   ├── date-formatter/         # Date formatting service
│   ├── dob-normalize/          # DOB normalization service
│   ├── time-parser/            # Time parsing service
│   └── zipcode-validate/       # Zipcode validation service
├── monitoring/                  # Monitoring configuration
├── infrastructure/             # Infrastructure setup scripts
├── index.js                    # Main application entry
├── package.json               # Node.js dependencies
├── Dockerfile                 # Container configuration
└── README.md                  # This file
```

## Security

- **Authentication**: Cloud Run services use Google IAM authentication
- **Secrets**: Managed via Google Secret Manager
- **Service Account**: Principle of least privilege
- **Network**: Services run in Google's secure network

## Contributing

1. Create a feature branch
2. Make your changes
3. Run tests locally
4. Submit a pull request
5. GitHub Actions will automatically test your changes
6. Once approved and merged, changes auto-deploy

## Support

For issues or questions:
1. Check [GitHub Issues](https://github.com/bdk76/bland-gcp-migration/issues)
2. Review deployment logs in GitHub Actions
3. Check Cloud Run logs in GCP Console

## License

[Your License Here]

---

**CI/CD Strategy**: GitHub Actions (Exclusive)  
**Last Updated**: August 30, 2024  
**Maintained By**: bdk76
