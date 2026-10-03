export function isLoopbackHost(host: string): boolean {
  return ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(host);
}

/** Shared deployment boundary for opt-in local diagnostics, independent of model provider. */
export function readLocalAiEnvironment(env: NodeJS.ProcessEnv, fail: () => Error): string {
  if (env.NODE_ENV !== 'development' || !['127.0.0.1', '::1'].includes(env.API_HOST ?? ''))
    throw fail();
  let database: URL;
  let frontend: URL;
  try {
    database = new URL(env.DATABASE_URL ?? '');
    frontend = new URL(env.FRONTEND_URL ?? '');
  } catch {
    throw fail();
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !isLoopbackHost(database.hostname) ||
    !isLoopbackHost(frontend.hostname) ||
    frontend.protocol !== 'http:' ||
    frontend.username ||
    frontend.password ||
    frontend.search ||
    frontend.hash ||
    frontend.pathname !== '/'
  )
    throw fail();
  return frontend.origin;
}
