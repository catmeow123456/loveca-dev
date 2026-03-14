import type { AuthUser } from './api.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
