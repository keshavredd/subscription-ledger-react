# ET Prime Weekly Performance Audit - Cloud Run Function

Automated Cloud Run Function (Python 3.11) triggered every Monday morning via Cloud Scheduler to deliver an executive performance audit comparing **Last Week (7 Days)** against the **Previous 4 Weeks Average**.

## Core Sections & Capabilities

1. **Weekly Revenue & Segment Breakdown**:
   - Total gross revenue (Last Week vs 4-Week Average, WoW % change).
   - Daily run-rate average (up or down % vs 28-day daily benchmark).
   - Multi-dimensional breakdown of revenue shift:
     - **Platform split** (`MWeb`, `Main Android`, `Main iOS`, `Market Android`, `Market iOS`, `Web`) with inline visual distribution bars.
     - **User type split** (`new`, `auto_renewal`, `manual_renewal`, `upgrade`, etc.).
     - **Marketing team split** (`Paid Marketing`, `Product Marketing`, `Telecalling`, `Organic`).
     - **Plan duration tenure split** (`1 Month`, `1 Year`, `2 Year`).

2. **ARPU (Yield Movement)**:
   - Overall blended ARPU last week vs 4-week average.
   - Platform-wise ARPU shifts.
   - User transaction type-wise ARPU.

3. **Renewals Retention**:
   - Weekly subscriptions due vs 4-week average due.
   - Renewals count & Renewal Rate % vs 4-week baseline.
   - Platform-wise renewal rate movement (in percentage points `pp`).

4. **Recurring Subscriptions**:
   - Recurring plans sold (`auto_renew == True`) vs 4-week average.
   - Recurring share of total sales (vs 4-week average in `pp`).
   - Platform-wise and marketing team recurring split.

5. **Aesthetics & Deliverables**:
   - **Rich HTML Email**: Modeled after your sample designs with ET Prime red banner, "AT A GLANCE" bullet card, 6 KPI cards with trend status pills, and client-safe CSS distribution bars.
   - **Executive PDF Attachment**: Automatically generated multi-page A4 PDF attachment built using ReportLab with tables and key takeaways.
   - **Gemini AI Commentary**: Automated executive takeaways, wins, and concerns synthesis.

---

## Deployment Instructions

### Prerequisites
- Google Cloud SDK (`gcloud`) installed and authenticated.
- A GCP project with Cloud Run, Cloud Functions, and Cloud Scheduler APIs enabled:
  ```bash
  gcloud services enable run.googleapis.com cloudfunctions.googleapis.com cloudscheduler.googleapis.com
  ```

### Step 1: Deploy to Cloud Run Functions (2nd Gen)
Run from the `cloud_run_weekly_report` directory:
```bash
gcloud functions deploy weekly-performance-audit \
  --gen2 \
  --runtime=python311 \
  --region=asia-south1 \
  --source=. \
  --entry-point=process_weekly_analytics_report \
  --trigger-http \
  --no-allow-unauthenticated \
  --memory=1Gi \
  --timeout=300s \
  --set-env-vars SENDER_EMAIL="keshava.reddy@timesinternet.in",RECIPIENT_EMAIL="keshava.reddy@timesinternet.in"
```

### Step 2: Configure Cloud Scheduler (Every Monday 8:00 AM IST)
```bash
# Retrieve Service Account
SERVICE_ACCOUNT=$(gcloud functions describe weekly-performance-audit --gen2 --region=asia-south1 --format='value(serviceConfig.serviceAccountEmail)')
FUNCTION_URI=$(gcloud functions describe weekly-performance-audit --gen2 --region=asia-south1 --format='value(serviceConfig.uri)')

# Create Cloud Scheduler Job
gcloud scheduler jobs create http monday-weekly-performance-trigger \
  --location=asia-south1 \
  --schedule="0 8 * * 1" \
  --time-zone="Asia/Kolkata" \
  --uri="$FUNCTION_URI" \
  --http-method=POST \
  --oidc-service-account-email="$SERVICE_ACCOUNT" \
  --description="Triggers Monday Weekly Performance Audit Email & PDF Report"
```

### Step 3: Trigger Manually Anytime (Dry-Run / Test)
```bash
gcloud scheduler jobs run monday-weekly-performance-trigger --location=asia-south1
```
Or test locally via Python:
```bash
pip install -r requirements.txt
python main.py
```
