
SELECT timestamp, host, port, statusCode, response, source, user, url, method 
FROM logs
where url like '/manage/v2/logs%'
-- and user like 'lk%'
order by user, response desc
LIMIT 10000000;
