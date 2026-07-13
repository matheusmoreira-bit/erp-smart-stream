UPDATE pagcorp_integration_log
SET settlement_status = 'pending',
    settlement_error = NULL,
    settlement_locked_at = NULL,
    settlement_retry_after = NULL,
    settlement_attempts = 0
WHERE id IN ('c0c3270e-6cfa-4869-834c-62e1bedd9df1','db0d8b5c-9712-4c1b-b987-890f7781101c');