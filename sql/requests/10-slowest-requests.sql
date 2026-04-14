
SELECT 
    timestamp,
    elapsedTime,
    url,
    user,
    -- ROUND(elapsedTime, 2) as elapsed_time_ms,
    pathPart1 || '/' || pathPart2 as endpoint
FROM requests
ORDER BY elapsedTime DESC
LIMIT 100;
