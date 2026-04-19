import { Router } from 'express';
import { db } from '../db/schema.js';

export const productsRouter = Router();

productsRouter.get('/', (req, res) => {
  const { category, featured, limit } = req.query;
  let sql = 'SELECT * FROM products WHERE active = 1';
  const params = [];

  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (featured === '1') sql += ' AND featured = 1';
  sql += ' ORDER BY featured DESC, created_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }

  const rows = db.prepare(sql).all(...params);
  res.json({ success: true, data: rows });
});

productsRouter.get('/:slug', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!row) return res.status(404).json({ success: false, error: 'Producto no encontrado' });
  res.json({ success: true, data: row });
});
