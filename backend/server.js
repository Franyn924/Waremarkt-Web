import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { productsRouter } from './routes/products.js';
import { categoriesRouter } from './routes/categories.js';
import { checkoutRouter } from './routes/checkout.js';
import { webhookRouter } from './routes/webhook.js';
import { adminRouter } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors({ origin: true, credentials: true }));

// Webhook necesita body raw — va ANTES de express.json()
app.use('/api/webhook', webhookRouter);

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', ts: new Date().toISOString() } });
});

app.use('/api/products', productsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/checkout', checkoutRouter);
app.use('/api/admin', adminRouter);

// Frontend estático (HTML/CSS/JS/imgs del proyecto)
app.use(express.static(path.join(__dirname, '..'), {
  index: 'index.html',
  extensions: ['html']
}));

// 404 solo para rutas /api no encontradas
app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'Not found' }));

// Error handler central
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  const code = err.statusCode || 500;
  res.status(code).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Error interno' : err.message
  });
});

app.listen(PORT, () => {
  console.log(`\n  Waremarkt API · http://localhost:${PORT}`);
  console.log(`  Health         · http://localhost:${PORT}/api/health`);
  console.log(`  Products       · http://localhost:${PORT}/api/products\n`);
});
