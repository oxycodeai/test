import { Router } from 'express';
import { isPinSet, setPin, verifyPin, createToken, setAuthCookie } from '../middleware/auth.js';
import { setSetting } from '../../db/index.js';
import { h } from '../middleware/error.js';

const r = Router();

r.get(
  '/status',
  h(async (req, res) => {
    res.json({ setup_required: !isPinSet(), authenticated: false });
  })
);

r.post(
  '/setup',
  h(async (req, res) => {
    if (isPinSet()) {
      return res.status(409).json({ error: { code: 'already_set', message: 'PIN already set' } });
    }
    const { pin } = req.body || {};
    setPin(pin);
    const token = createToken();
    setAuthCookie(res, token);
    res.json({ ok: true, token });
  })
);

r.post(
  '/login',
  h(async (req, res) => {
    if (!isPinSet()) {
      return res.status(400).json({ error: { code: 'setup_required', message: 'Set PIN first' } });
    }
    const { pin } = req.body || {};
    if (!verifyPin(pin)) {
      return res.status(401).json({ error: { code: 'bad_pin', message: 'Incorrect PIN' } });
    }
    const token = createToken();
    setAuthCookie(res, token);
    res.json({ ok: true, token });
  })
);

r.post(
  '/logout',
  h(async (req, res) => {
    setSetting('auth_token', '');
    res.setHeader('Set-Cookie', 'kb_token=; HttpOnly; Path=/; Max-Age=0');
    res.json({ ok: true });
  })
);

export default r;
