import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../shared/constants.js';
import { requireAuth } from './middleware/auth.js';
import { notFound, errorHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import systemRoutes, { healthHandler } from './routes/system.js';
import streamRoutes from './routes/stream.js';
import accountRoutes from './routes/accounts.js';
import productRoutes from './routes/products.js';
import commissionRoutes from './routes/commission.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // public: auth bootstrap + health (Railway healthcheck / Settings link)
  app.use('/api/auth', authRoutes);
  app.get('/api/health', healthHandler);
  app.get('/api/ping', (req, res) => res.json({ ok: true }));

  // protected
  app.use('/api', requireAuth);
  app.use('/api', systemRoutes);
  app.use('/api', streamRoutes);
  app.use('/api/accounts', accountRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/commission', commissionRoutes);
  app.use('/api', notFound);

  // built SPA (Phase 1 ke baad — dev me vite alag chalta hai)
  if (fs.existsSync(paths.webDist)) {
    app.use(express.static(paths.webDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(paths.webDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
