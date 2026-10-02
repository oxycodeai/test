import { Router } from 'express';
import { h } from '../middleware/error.js';
import { isConfigured } from '../integrations/cuelinks.js';
import { config } from '../../shared/constants.js';

const r = Router();

// Phase 1 stub — Phase 4 me real Cuelinks sync aayega (phase-4/README.md §4.4).
r.get(
  '/',
  h(async (req, res) => {
    res.json({
      mode: config.affiliateMode,
      available: false,
      reason: isConfigured()
        ? 'sync lands in Phase 4'
        : 'CUELINKS_API_KEY not set (AFFILIATE_MODE=manual)',
      total: 0,
      pending: 0,
      approved: 0,
      items: [],
    });
  })
);

export default r;
