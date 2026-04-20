import { Router } from 'express';
import { db } from '../db/schema.js';

export const categoriesRouter = Router();

categoriesRouter.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, slug, name_es, name_en, icon, sort_order
    FROM categories
    WHERE active = 1
    ORDER BY sort_order ASC, name_es ASC
  `).all();
  res.json({ success: true, data: rows });
});
