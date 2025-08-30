# Monitoring and Alerting Setup

This directory contains monitoring configuration for the Bland API Cloud Run services.

## Quick Setup

1. **Set your notification email:**
   ```bash
   export NOTIFICATION_EMAIL="your-email@example.com"
   ```

2. **Run the setup script:**
   ```bash
   chmod +x setup-monitoring.sh
   ./setup-monitoring.sh
   ```

## What Gets Created

### 📊 Monitoring Dashboard
- Request rate metrics
- Response latency (95th percentile)
- Error rate tracking
- Memory utilization
- CPU utilization
- Container instance count

### 🔔 Alert Policies

1. **High Error Rate Alert**
   - Triggers when error rate > 1%
   - Monitors all Cloud Run services

2. **High Latency Alert**
   - Triggers when 95th percentile latency > 2 seconds
   - Helps identify performance issues

3. **Service Down Alert**
   - Triggers when uptime checks fail
   - Monitors health endpoints

4. **High Memory Usage Alert**
   - Triggers when memory utilization > 90%
   - Prevents out-of-memory issues

### ✅ Uptime Checks
- Monitors `/health` endpoints for all environments
- Checks every 60 seconds
- Alerts on failures

## Manual Dashboard Creation

To create the dashboard manually:

1. Go to [Cloud Monitoring Dashboards](https://console.cloud.google.com/monitoring/dashboards)
2. Click "Create Dashboard"
3. Click "Add Chart" and configure metrics as needed
4. Or use the JSON configuration:
   ```bash
   gcloud monitoring dashboards create --config-from-file=dashboard.json
   ```

## Viewing Metrics

### Cloud Run Metrics
- [Cloud Run Console](https://console.cloud.google.com/run)
- Select your service → Metrics tab

### Monitoring Dashboard
- [Monitoring Console](https://console.cloud.google.com/monitoring)
- Dashboards → Bland API Dashboard

### Logs
- [Logs Explorer](https://console.cloud.google.com/logs)
- Filter by `resource.type="cloud_run_revision"`

## Alert Configuration

### Update Notification Channels
```bash
# List existing channels
gcloud alpha monitoring channels list

# Update email
gcloud alpha monitoring channels update CHANNEL_ID \
  --update-channel-labels=email_address=new-email@example.com
```

### Modify Alert Thresholds
Edit the policy JSON files in `setup-monitoring.sh` and re-run the script.

## SLO Recommendations

Based on best practices, consider these Service Level Objectives:

- **Availability**: 99.9% uptime (43.2 minutes downtime/month)
- **Latency**: 95% of requests < 500ms
- **Error Rate**: < 0.1% of requests result in errors

## Cost Optimization

To reduce monitoring costs:

1. **Adjust retention periods**
   ```bash
   gcloud logging sinks update SINK_NAME --log-filter="severity>=WARNING"
   ```

2. **Sample logs for high-volume services**
   ```bash
   gcloud logging sinks update SINK_NAME --log-filter="sample(0.1)"
   ```

3. **Use log exclusions**
   ```bash
   gcloud logging exclusions create health-checks \
     --log-filter="resource.type=cloud_run_revision AND httpRequest.requestUrl=~'/health'"
   ```

## Troubleshooting

### No metrics showing
- Ensure services are deployed and receiving traffic
- Check IAM permissions for monitoring

### Alerts not firing
- Verify notification channels are configured
- Check alert policy conditions and thresholds

### Missing uptime checks
- Ensure services are deployed before running setup
- Verify service URLs are accessible

## Additional Resources

- [Cloud Run Monitoring](https://cloud.google.com/run/docs/monitoring)
- [Cloud Monitoring Documentation](https://cloud.google.com/monitoring/docs)
- [Alert Policy Best Practices](https://cloud.google.com/monitoring/alerts/best-practices)
