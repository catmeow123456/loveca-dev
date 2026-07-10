process.env.DATABASE_URL ??= 'postgres://loveca_test:loveca_test@127.0.0.1:5432/loveca_test';
process.env.JWT_SECRET ??= 'loveca-test-jwt-secret';
process.env.JWT_REFRESH_SECRET ??= 'loveca-test-refresh-secret';
process.env.FRONTEND_URL ??= 'http://127.0.0.1:5173';
process.env.MINIO_ENDPOINT ??= '127.0.0.1';
process.env.MINIO_ACCESS_KEY ??= 'loveca-test-access-key';
process.env.MINIO_SECRET_KEY ??= 'loveca-test-secret-key';
