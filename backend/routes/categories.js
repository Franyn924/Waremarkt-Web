import { Router } from 'express';
import { pool } from '../db/schema.js';

export const categoriesRouter = Router();

categoriesRouter.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, slug, name_es, name_en, icon, sort_order, parent_id
      FROM categories
      WHERE active = 1
      ORDER BY sort_order ASC, name_es ASC
    `);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});
