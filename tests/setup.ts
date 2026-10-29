process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/laporinaja_test?schema=public";
process.env.SESSION_SECRET ??= "test-session-secret-that-is-at-least-32-characters";
process.env.GOOGLE_CLIENT_ID ??= "test-google-client-id.apps.googleusercontent.com";
process.env.FRONTEND_ORIGINS ??= "http://localhost:5173";
process.env.SESSION_COOKIE_SECURE ??= "false";
process.env.UPLOAD_DIR ??= "test-uploads";
process.env.MAX_UPLOAD_REQUEST_BYTES ??= String(20 * 1024 * 1024);
