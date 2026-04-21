import { Router } from 'express';
import { pool } from '../db/schema.js';

export const productsRouter = Router();

productsRouter.get('/', async (req, res, next) => {
  try {
    const { category, featured, limit, q } = req.query;
    let sql = 'SELECT * FROM products WHERE active = 1';
    const params = [];

    if (category) {
      // Si la categoría es padre, expande a sí misma + todas sus subcategorías activas
      sql += ` AND (category = ? OR category IN (
        SELECT c.slug FROM categories c
        JOIN categories p ON c.parent_id = p.id
        WHERE p.slug = ? AND c.active = 1
      ))`;
      params.push(category, category);
    }
    if (featured === '1') sql += ' AND featured = 1';

    const term = String(q || '').trim();
    if (term) {
      const like = `%${term}%`;
      sql += ' AND (name LIKE ? OR brand LIKE ? OR description LIKE ? OR sku LIKE ? OR slug LIKE ?)';
      params.push(like, like, like, like, like);
    }

    sql += ' ORDER BY featured DESC, created_at DESC';
    const lim = Math.max(0, Math.min(1000, Number(limit) || 0));
    if (lim > 0) sql += ` LIMIT ${lim}`;

    const [rows] = await pool.execute(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

productsRouter.get('/:slug', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM products WHERE slug = ? AND active = 1',
      [req.params.slug]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Producto no encontrado' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});
