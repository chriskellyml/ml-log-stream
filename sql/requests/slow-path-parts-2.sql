
SELECT 
    pathPart1 || '/' || pathPart2 as endpoint,
    COUNT(*) as request_count,
    ROUND(AVG(elapsedTime), 2) as avg_elapsed_time
FROM requests
WHERE pathPart1 IS NOT NULL
GROUP BY pathPart1, pathPart2
ORDER BY request_count DESC
LIMIT 35;
