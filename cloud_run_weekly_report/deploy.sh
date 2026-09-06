#!/usr/bin/env bash
# ==============================================================================
# Deployment Script for ET Prime Weekly Performance Audit (Cloud Run Function)
# ==============================================================================

PROJECT_ID=$(gcloud config get-value project)
REGION="asia-south1" # Mumbai region (or us-central1)
FUNCTION_NAME="weekly-performance-audit"
SCHEDULER_JOB_NAME="monday-weekly-performance-trigger"

echo "Deploying Cloud Run Function: ${FUNCTION_NAME} in project ${PROJECT_ID}, region ${REGION}..."

# 1. Deploy the Cloud Function (2nd Gen / Cloud Run)
gcloud functions deploy ${FUNCTION_NAME} \
  --gen2 \
  --runtime=python311 \
  --region=${REGION} \
  --source=. \
  --entry-point=process_weekly_analytics_report \
  --trigger-http \
  --no-allow-unauthenticated \
  --memory=1Gi \
  --timeout=300s \
  --set-env-vars SENDER_EMAIL="keshava.reddy@timesinternet.in",RECIPIENT_EMAIL="keshava.reddy@timesinternet.in"

# 2. Get the Function URL
FUNCTION_URL=$(gcloud functions describe ${FUNCTION_NAME} --gen2 --region=${REGION} --format='value(serviceConfig.uri)')
echo "Function deployed at: ${FUNCTION_URL}"

# 3. Create or Update Cloud Scheduler Job to run every Monday at 8:00 AM IST
echo "Setting up Cloud Scheduler to run every Monday at 8:00 AM IST (Asia/Kolkata)..."
SERVICE_ACCOUNT=$(gcloud functions describe ${FUNCTION_NAME} --gen2 --region=${REGION} --format='value(serviceConfig.serviceAccountEmail)')

gcloud scheduler jobs delete ${SCHEDULER_JOB_NAME} --location=${REGION} --quiet 2>/dev/null || true

gcloud scheduler jobs create http ${SCHEDULER_JOB_NAME} \
  --location=${REGION} \
  --schedule="0 8 * * 1" \
  --time-zone="Asia/Kolkata" \
  --uri="${FUNCTION_URL}" \
  --http-method=POST \
  --oidc-service-account-email="${SERVICE_ACCOUNT}" \
  --description="Triggers Monday Weekly Performance Audit Email & PDF Report"

echo "✅ Deployment and Monday Scheduler setup complete!"
