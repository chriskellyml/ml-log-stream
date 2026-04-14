SELECT 
    SUBSTR(url, 1, INSTR(url || '?', '?') - 1) as full_path,
    COUNT(*) as request_count,
    ROUND(AVG(elapsedTime), 2) as avg_elapsed_time
FROM requests
WHERE url LIKE '/v1/api/%'
GROUP BY full_path
ORDER BY request_count DESC
LIMIT 15;

