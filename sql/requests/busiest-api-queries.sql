
SELECT 
    '/v1/api/' || 
    CASE 
        WHEN INSTR(SUBSTR(url, 9), '/') > 0 
        THEN SUBSTR(SUBSTR(url, 9), 1, INSTR(SUBSTR(url, 9), '/') - 1)
        ELSE SUBSTR(url, 9)
    END as endpoint,
    COUNT(*) as request_count
FROM logs
WHERE url LIKE '/v1/api/%'
GROUP BY endpoint
ORDER BY request_count DESC
LIMIT 15;

