import { Router } from 'express';
import { getAllSettings } from '../db/schema.js';

export const settingsRouter = Router();

// Solo claves públicas (no exponer URLs de checkout ni emails privados)
const PUBLIC_KEYS = ['store_name', 'currency', 'shipping_flat_cents', 'whatsapp_number'];

settingsRouter.get('/', (req, res) => {
  const all = getAllSettings();
  const pub = {};
  for (const k of PUBLIC_KEYS) if (k in all) pub[k] = all[k];
  res.json({ success: true, data: pub });
});
