# Lovable Cloud resource diagnosis — 18 November 2026

## Findings (11:56–12:01 UTC; read-only)

- Current server size: Mini. Database/auth reachable, no restarts recorded.
- Memory snapshots: 67–73%; data disk: 66%; database size: 10.53 GB; WAL: 1 GB.
- Connections: 23–24 of 60; pooled clients: 1 of 200. No evidence of current connection exhaustion.
- Historical CPU alert: 93.22% at 02:56:16 UTC (17 November 23:56 Brasília). Current CPU utilization was not returned; cannot prove CPU recovery or sustained saturation.
- Aborted transaction counters are cumulative, but independent pg_stat_database reads rose from 49,143,655 at 11:59:03 to 49,236,594 at 12:01:07: roughly 750/s. This is a live anomaly; the responsible statement/backend remains unproven. Do not equate these with failed payments or documents.

## Likely workload and confirmed inefficiencies

1. SAP synchronization is a high-volume workload: the highest cumulative statement cost is 188,467 single-row expense status writes, mean 5.09 ms. Counts cover the statistics lifetime, not today's rate.
2. Invoice capture repeatedly pages the full cross-company SAP invoice cache. A read-only EXPLAIN ANALYZE for LIMIT 1000/OFFSET 1000 scanned 19,897 rows and sorted the eligible 18,930, taking 50.27 ms. Existing indexes start with company_db and do not match this global ordering. Consider incremental/keyset reads and an appropriate partial ordering index after testing; do not weaken company authorization.
3. Scheduled automation runs continuously: retry and notification workers each dispatch 720 times/day. Scheduler success measures dispatch, not downstream success. The CPU alert coincides with purchase cache sync and the two-minute workers, but this does not establish causation.
4. Retained relation sizes: cron.job_run_details ~4.79 GB and public.audit_trail ~4.64 GB including indexes. Allocated size does not establish live row volume or reclaimable disk; preserve audit history and inspect retention/bloat before cleanup.
5. Daily prune job 10 failed at 03:15 UTC: prune_old_integration_data references nonexistent whatsapp_login_alerts.created_at. The failure aborts that invocation, including later telemetry retention. It occurs after the CPU alert, so is not evidence of that alert's cause.

## Recommendation and cost trade-off

**GO for targeted optimization investigation; NO-GO for immediate resizing or declaring full recovery.** Resolve the rapidly rising aborted transactions, repair retention with verified date columns, reduce unnecessary sync writes, and test invoice read improvements first. No production data, schedule, permissions, credentials, security checks, or instance size were changed by this diagnosis.

Keeping Mini avoids a new recurring compute increase, but requires engineering work and subsequent measurement. Small is the next size to consider if sustained CPU/memory pressure remains after optimization; more capacity does not fix repeated errors or retention growth. Compute and disk are separate: no disk increase is currently justified by 66% utilization.

Exact Mini/Small hourly credit prices were unavailable from tools and official documentation. Do not invent a monetary or credit delta. More → Database → Manage → Settings → Manage displays the current estimated monthly cost for each size; this includes other backend usage, not compute alone, and uses recent activity/default estimates. Compare Mini and Small there before requesting approval. A resize restarts the database, briefly interrupts the app, and takes a few minutes.

The requested database-pressure skill was not available in the knowledge catalog; diagnosis used the official Cloud troubleshooting guidance and read-only metrics instead.

## Checks and remaining limits

Checks: Cloud reachability, repeated health snapshots, current instance size, pg_stat_database counter delta, aggregate activity, slow-query statistics, indexes, SELECT EXPLAIN ANALYZE, relation sizes, cron schedules/run history and failed retention definition.

No application behavior was modified, so no additional application tests were required for this diagnostic request. Exact current CPU, cause of aborted transactions, recoverable disk, and current cost difference remain unverified. Existing access-control work remains disabled pending its separate end-to-end checks and signed-link expiry decision.