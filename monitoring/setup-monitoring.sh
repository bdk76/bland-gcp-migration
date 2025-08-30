#!/bin/bash

# Setup Monitoring and Alerting for Cloud Run Services
# This script creates monitoring dashboards, uptime checks, and alert policies

set -e

PROJECT_ID="bland-gcp-migration"
REGION="us-central1"
SERVICE_NAME="bland-api"
NOTIFICATION_EMAIL="${NOTIFICATION_EMAIL:-admin@example.com}"

echo "Setting up monitoring for $PROJECT_ID..."

# Enable monitoring APIs
echo "Enabling monitoring APIs..."
gcloud services enable monitoring.googleapis.com \
  cloudtrace.googleapis.com \
  clouderrorreporting.googleapis.com \
  cloudprofiler.googleapis.com \
  --project=$PROJECT_ID

# Create notification channel (email)
echo "Creating notification channel..."
CHANNEL_ID=$(gcloud alpha monitoring channels create \
  --display-name="Email Notifications" \
  --type=email \
  --channel-labels=email_address=$NOTIFICATION_EMAIL \
  --project=$PROJECT_ID \
  --format="value(name)" 2>/dev/null || echo "")

if [ -z "$CHANNEL_ID" ]; then
  echo "Notification channel might already exist, fetching..."
  CHANNEL_ID=$(gcloud alpha monitoring channels list \
    --filter="type=email" \
    --project=$PROJECT_ID \
    --format="value(name)" | head -1)
fi

echo "Notification channel: $CHANNEL_ID"

# Create uptime check for each environment
for ENV in production staging development; do
  SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME}-${ENV} \
    --region=$REGION \
    --project=$PROJECT_ID \
    --format="value(status.url)" 2>/dev/null || echo "")
  
  if [ ! -z "$SERVICE_URL" ]; then
    echo "Creating uptime check for ${SERVICE_NAME}-${ENV}..."
    
    gcloud monitoring uptime-checks create https ${SERVICE_NAME}-${ENV}-health \
      --display-name="${SERVICE_NAME}-${ENV} Health Check" \
      --uri="${SERVICE_URL}/health" \
      --project=$PROJECT_ID || echo "Uptime check might already exist"
  fi
done

# Create alert policies

# 1. High error rate alert
echo "Creating high error rate alert..."
cat > /tmp/error-rate-policy.json <<EOF
{
  "displayName": "High Error Rate - Cloud Run",
  "conditions": [{
    "displayName": "Error rate > 1%",
    "conditionThreshold": {
      "filter": "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.label.response_code_class!=\"2xx\"",
      "aggregations": [{
        "alignmentPeriod": "60s",
        "perSeriesAligner": "ALIGN_RATE"
      }],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 0.01,
      "duration": "60s"
    }
  }],
  "notificationChannels": ["$CHANNEL_ID"],
  "alertStrategy": {
    "autoClose": "1800s"
  }
}
EOF

gcloud alpha monitoring policies create --policy-from-file=/tmp/error-rate-policy.json \
  --project=$PROJECT_ID || echo "Policy might already exist"

# 2. High latency alert
echo "Creating high latency alert..."
cat > /tmp/latency-policy.json <<EOF
{
  "displayName": "High Latency - Cloud Run",
  "conditions": [{
    "displayName": "95th percentile latency > 2s",
    "conditionThreshold": {
      "filter": "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_latencies\"",
      "aggregations": [{
        "alignmentPeriod": "60s",
        "perSeriesAligner": "ALIGN_PERCENTILE_95"
      }],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 2000,
      "duration": "300s"
    }
  }],
  "notificationChannels": ["$CHANNEL_ID"],
  "alertStrategy": {
    "autoClose": "1800s"
  }
}
EOF

gcloud alpha monitoring policies create --policy-from-file=/tmp/latency-policy.json \
  --project=$PROJECT_ID || echo "Policy might already exist"

# 3. Service down alert
echo "Creating service down alert..."
cat > /tmp/uptime-policy.json <<EOF
{
  "displayName": "Service Down - Cloud Run",
  "conditions": [{
    "displayName": "Uptime check failure",
    "conditionThreshold": {
      "filter": "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\"",
      "aggregations": [{
        "alignmentPeriod": "60s",
        "perSeriesAligner": "ALIGN_FRACTION_TRUE"
      }],
      "comparison": "COMPARISON_LT",
      "thresholdValue": 0.9,
      "duration": "180s"
    }
  }],
  "notificationChannels": ["$CHANNEL_ID"],
  "alertStrategy": {
    "autoClose": "1800s"
  }
}
EOF

gcloud alpha monitoring policies create --policy-from-file=/tmp/uptime-policy.json \
  --project=$PROJECT_ID || echo "Policy might already exist"

# 4. Memory usage alert
echo "Creating memory usage alert..."
cat > /tmp/memory-policy.json <<EOF
{
  "displayName": "High Memory Usage - Cloud Run",
  "conditions": [{
    "displayName": "Memory utilization > 90%",
    "conditionThreshold": {
      "filter": "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/container/memory/utilizations\"",
      "aggregations": [{
        "alignmentPeriod": "60s",
        "perSeriesAligner": "ALIGN_PERCENTILE_99"
      }],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 0.9,
      "duration": "300s"
    }
  }],
  "notificationChannels": ["$CHANNEL_ID"],
  "alertStrategy": {
    "autoClose": "1800s"
  }
}
EOF

gcloud alpha monitoring policies create --policy-from-file=/tmp/memory-policy.json \
  --project=$PROJECT_ID || echo "Policy might already exist"

# Clean up temp files
rm -f /tmp/*-policy.json

echo ""
echo "==================================================================="
echo "Monitoring Setup Complete!"
echo "==================================================================="
echo ""
echo "Created:"
echo "  - Notification channel for: $NOTIFICATION_EMAIL"
echo "  - Uptime checks for health endpoints"
echo "  - Alert policies for:"
echo "    • High error rate (>1%)"
echo "    • High latency (>2s)"
echo "    • Service downtime"
echo "    • High memory usage (>90%)"
echo ""
echo "View monitoring dashboard:"
echo "  https://console.cloud.google.com/monitoring?project=$PROJECT_ID"
echo ""
echo "View Cloud Run metrics:"
echo "  https://console.cloud.google.com/run?project=$PROJECT_ID"
echo ""
echo "To update notification email:"
echo "  NOTIFICATION_EMAIL=your-email@example.com ./setup-monitoring.sh"
echo ""
