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

---

## Insights Hub report packs (added 2026-09-19)

The job writes four Firestore docs per week into `insight_reports` (`{reportType}_{weekEnd}`), one per dashboard tab, and each one is now built independently:

| reportType | Narrative scope | Detailed report tables |
|---|---|---|
| `weekly_revenue_aop` | AOP pacing, weekly revenue, ARPU | Revenue by platform / user type / plan tenure, ARPU by platform (+ `htmlBody` email overview and `fullReportText` combined audit) |
| `weekly_funnel` | Acquisition funnel | Step table LW vs 4W, platform funnel, marketing-team funnel, India vs International, team x platform purchases |
| `weekly_renewals_recurring` | Renewals + recurring | Renewals by platform / plan tenure, platform x plan rate matrix, recurring by platform / plan / team |
| `weekly_team_channel` | Team & channel attribution | Team revenue, team x platform, team x user type, team ARPU, team recurring, team funnel purchases |

Each doc carries `schemaVersion: 2`, `narrative.{key_highlights, wins, watch_outs, takeaway, source}` (`source` = `gemini` or `deterministic`), `keyMetrics` (JSON tables) and `reportText` (that tab's markdown). Four focused Gemini calls replace the single shared narrative; each has a numbers-only fallback when Gemini is unavailable.

**Funnel source.** The funnel is queried from BigQuery (`FUNNEL_BQ_SQL`, same query as the dashboard's `Dau_funnel_data` extract) for the last `FUNNEL_LOOKBACK_DAYS` (42) days, because the sheet extract only keeps selected dates. On any failure the job falls back to the sheet / CSV. The Cloud Run service account needs `BigQuery Job User` on the billing project (`BQ_BILLING_PROJECT`, default `et-poc-042021`) and `BigQuery Data Viewer` on `et-analytics-385414.cdp`. Set `BQ_FUNNEL_ENABLED=0` to force the sheet path.

**Funnel aggregation fix.** The feed has one row per (date, view, platform, country, team); the audit now pins `Country = Overall` and `Marketing_team = Overall` before summing. Previously every cut was summed together, inflating DAU and paywall hits several times over in the email and PDF.

**Backfill.** `GET/POST ?week_end=YYYY-MM-DD&send_email=0` audits the week ending on that date (rows after it are ignored, MTD pacing follows that month), writes the four docs and skips the email. Example for the two September weeks before the first live run:

```
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$FUNCTION_URL?week_end=2026-09-06&send_email=0"
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$FUNCTION_URL?week_end=2026-09-13&send_email=0"
```

**Reset & backfill runbook (2026-09-20).** To start the Hub archive clean with the two September weeks and let the Monday schedule continue from there:

1. Wipe `insight_reports` (nothing else is touched). `tools/purge_insight_reports.cjs` lists the docs first; only `--delete` removes them. It needs the Firebase Admin key of `subscription-ledger-849a8` (default path: `~/Downloads/subscription-ledger-849a8-firebase-adminsdk-fbsvc-33117a2a6e.json`, override with `FIREBASE_SA_KEY`) and `firebase-admin` on `NODE_PATH` or installed with `npm i --no-save firebase-admin`.
   ```
   node cloud_run_weekly_report/tools/purge_insight_reports.cjs            # dry run
   node cloud_run_weekly_report/tools/purge_insight_reports.cjs --delete
   ```
2. Backfill the two weeks from Cloud Shell (project `et-poc-042021`), which has `gcloud` and can mint the identity token the service requires:
   ```
   URL=$(gcloud run services describe weekly-etprime-inisghts --region asia-south1 --format 'value(status.url)')
   curl -sS -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$URL?week_end=2026-09-06&send_email=0"; echo
   curl -sS -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$URL?week_end=2026-09-13&send_email=0"; echo
   ```
   Each response echoes `window` (expect `31 Aug 2026 - 06 Sep 2026` and `07 Sep 2026 - 13 Sep 2026`) and `narrative_sources`. Doc ids land as `{type}_2026-09-06` and `{type}_2026-09-13`; re-running a backfill overwrites the same ids.
3. Re-run the dry-run lister: exactly 8 docs, `schema=2`. The Insights Hub shows both weeks under every tab after a refresh.
4. The Monday schedule then adds the week ending on the sheet's latest date. The week window is the last 7 days ending on the newest date in the subscription sheet, so the Monday run yields `..._2026-09-20` only if the sheet holds data through Sunday and no partial Monday rows when the scheduler fires. Backfill a Sunday explicitly (`?week_end=2026-09-20`) if the live run lands on another day.

## PDF attachment (rebuilt 2026-09-19)

`generate_pdf_report(metrics, narrative, path, pack_narratives=...)` renders DM Sans (TTF fetched once per instance from Google Fonts into the temp dir; Helvetica fallback writes ₹ as "Rs"). Page 1 is the overview (header, AOP pacing, six KPI tiles, key highlights, wins / watch-outs). Then one chapter per Insights Hub report pack with that pack's narrative, horizontal bar charts and every table the dashboard stores. The section list comes from `pack_sections(pack_id, metrics)`, which also drives the Hub markdown, so PDF and dashboard cannot drift. Avoid glyphs DM Sans lacks in table headers (▲ ▼ Δ ■); `_pdf_text` strips the arrows from narrative text.
