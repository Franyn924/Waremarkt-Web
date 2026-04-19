import { db } from './schema.js';

const seedProducts = [
  {
    slug: 'laptop-gaming-rtx-4060',
    name: 'Laptop Gaming RTX 4060',
    category: 'computacion',
    brand: 'ASUS',
    description: 'Laptop gaming de 15.6" con NVIDIA RTX 4060, Intel Core i7, 16GB RAM DDR5 y SSD NVMe de 1TB. Pantalla 144Hz para gaming competitivo.',
    price_cents: 129900,
    compare_at_cents: 152900,
    stock: 8,
    icon: 'laptop',
    badge: '-15%',
    featured: 1
  },
  {
    slug: 'audifonos-pro-wireless',
    name: 'Audífonos Pro Wireless',
    category: 'accesorios',
    brand: 'Sony',
    description: 'Audífonos inalámbricos con cancelación activa de ruido, autonomía de 30h y sonido Hi-Res. Bluetooth 5.3 multipunto.',
    price_cents: 18900,
    compare_at_cents: null,
    stock: 24,
    icon: 'headphones',
    badge: null,
    featured: 1
  },
  {
    slug: 'teclado-mecanico-rgb',
    name: 'Teclado Mecánico RGB',
    category: 'accesorios',
    brand: 'Logitech',
    description: 'Teclado mecánico con switches tactile, iluminación RGB por tecla y construcción en aluminio. Compatible con Windows y Mac.',
    price_cents: 12900,
    compare_at_cents: null,
    stock: 18,
    icon: 'keyboard',
    badge: 'NUEVO',
    featured: 1
  },
  {
    slug: 'monitor-27-144hz',
    name: 'Monitor 27" 144Hz',
    category: 'computacion',
    brand: 'LG',
    description: 'Monitor QHD de 27" con panel IPS, 144Hz de refresco y 1ms de respuesta. FreeSync y HDR10 incluidos.',
    price_cents: 34900,
    compare_at_cents: null,
    stock: 12,
    icon: 'monitor',
    badge: null,
    featured: 1
  },
  {
    slug: 'mouse-ergonomico-bluetooth',
    name: 'Mouse Ergonómico Bluetooth',
    category: 'accesorios',
    brand: 'Logitech',
    description: 'Mouse ergonómico inalámbrico con 7 botones programables, sensor de 4000 DPI y batería recargable USB-C.',
    price_cents: 5900,
    compare_at_cents: 7900,
    stock: 42,
    icon: 'mouse',
    badge: '-25%',
    featured: 0
  },
  {
    slug: 'desktop-ryzen-9',
    name: 'Desktop Ryzen 9 + RTX 4070',
    category: 'computacion',
    brand: 'HP',
    description: 'Workstation con AMD Ryzen 9 7900X, 32GB DDR5, RTX 4070 Ti y SSD NVMe de 2TB. Para creadores y gamers exigentes.',
    price_cents: 239900,
    compare_at_cents: null,
    stock: 4,
    icon: 'cpu',
    badge: null,
    featured: 0
  },
  {
    slug: 'webcam-4k-pro',
    name: 'Webcam 4K Pro',
    category: 'accesorios',
    brand: 'Logitech',
    description: 'Webcam 4K Ultra HD con autoenfoque, micrófonos stereo y corrección de iluminación automática. Ideal para streaming.',
    price_cents: 19900,
    compare_at_cents: null,
    stock: 15,
    icon: 'video',
    badge: null,
    featured: 0
  },
  {
    slug: 'ssd-nvme-2tb',
    name: 'SSD NVMe 2TB Gen4',
    category: 'computacion',
    brand: 'Samsung',
    description: 'SSD NVMe M.2 PCIe Gen4 de 2TB con velocidades de lectura hasta 7000 MB/s. Ideal para gaming y edición.',
    price_cents: 14900,
    compare_at_cents: 17900,
    stock: 30,
    icon: 'hard-drive',
    badge: '-16%',
    featured: 0
  }
];

const insert = db.prepare(`
  INSERT OR REPLACE INTO products
  (slug, name, category, brand, description, price_cents, compare_at_cents, stock, icon, badge, featured, active)
  VALUES (@slug, @name, @category, @brand, @description, @price_cents, @compare_at_cents, @stock, @icon, @badge, @featured, 1)
`);

const tx = db.transaction((items) => {
  for (const p of items) insert.run(p);
});

tx(seedProducts);

const count = db.prepare('SELECT COUNT(*) as n FROM products').get();
console.log(`✓ Seeded ${seedProducts.length} products. DB has ${count.n} rows.`);
