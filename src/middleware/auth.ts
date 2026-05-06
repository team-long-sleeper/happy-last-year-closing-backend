import type { Request, Response, NextFunction } from 'express';
import type { JwtPayload } from 'jsonwebtoken';
import * as Sentry from '@sentry/node';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not set');

export function requireProviderToken(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing Bearer token' });
  }

  const accessToken = header.slice('Bearer '.length).trim();
  (req as any).providerAccessToken = accessToken;
  next();
}

type AccessPayLoad = JwtPayload & { userId: string };

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; rawToken: string };
    }
  }
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;

  const [type, token] = header.split(' ');
  if (type !== 'Bearer' || !token) return null;

  return token;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractBearer(req);
  if (!token) {
    return res.status(401).json({ message: 'Missing Authorization Bearer Token' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET!, {
      algorithms: ['HS256'],
      issuer: 'happy-last-year-closing',
      audience: 'happy-last-year-closing',
    }) as AccessPayLoad;

    if (!decoded.userId) {
      return res.status(401).json({ message: 'Invalid token payload' });
    }

    req.auth = { userId: decoded.userId, rawToken: token };
    Sentry.setUser({ id: decoded.userId });
    return next();
  } catch (error: any) {
    return res.status(401).json({ message: 'Invalid or expired token', code: error?.name });
  }
}
