export function requireAdmin(req, res, next) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return res.status(500).json({ success: false, error: 'ADMIN_TOKEN no configurado' });

  const header = req.headers.authorization || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (provided !== token) {
    return res.status(401).json({ success: false, error: 'No autorizado' });
  }
  next();
}
