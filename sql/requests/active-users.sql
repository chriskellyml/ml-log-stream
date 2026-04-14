SELECT 
    user,
    COUNT(*) as request_count,
    COUNT(DISTINCT source) as servers_accessed,
    MIN(timestamp) as first_activity,
    MAX(timestamp) as last_activity
FROM logs
WHERE user IS NOT NULL
GROUP BY user
ORDER BY request_count DESC
LIMIT 15;
