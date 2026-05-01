// Carrito Waremarkt — global (no módulo) para inicializar antes de Alpine
(function (global) {
  const API = global.WAREMARKT_API || (location.hostname === 'localhost' ? 'http://localhost:3001/api' : '/api');
  const CART_KEY = 'waremarkt_cart_v1';
  const WA = '14079434098';

  const cart = {
    items() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; } },
    save(items) { localStorage.setItem(CART_KEY, JSON.stringify(items)); this.emit(); },
    count() { return this.items().reduce((s, i) => s + i.quantity, 0); },
    total() { return this.items().reduce((s, i) => s + i.price_cents * i.quantity, 0); },

    add(product, qty = 1) {
      const items = this.items();
      const existing = items.find(i => i.slug === product.slug);
      if (existing) existing.quantity += qty;
      else items.push({
        slug: product.slug,
        name: product.name,
        price_cents: product.price_cents,
        icon: product.icon,
        image_url: product.image_url || null,
        brand: product.brand,
        quantity: qty
      });
      this.save(items);
    },

    setQty(slug, qty) {
      const items = this.items();
      const it = items.find(i => i.slug === slug);
      if (!it) return;
      if (qty <= 0) return this.remove(slug);
      it.quantity = qty;
      this.save(items);
    },

    remove(slug) { this.save(this.items().filter(i => i.slug !== slug)); },
    clear() { this.save([]); },

    emit() {
      window.dispatchEvent(new CustomEvent('cart:update', { detail: { count: this.count(), total: this.total() } }));
    },

    async checkoutStripe(extra = {}) {
      const items = this.items().map(i => ({ slug: i.slug, quantity: i.quantity }));
      const res = await fetch(`${API}/checkout/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, ...extra })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      window.location.href = json.data.url;
    },

    checkoutWhatsApp() {
      const items = this.items();
      if (items.length === 0) return;
      const lines = items.map(i => `• ${i.quantity}× ${i.name} — $${(i.price_cents * i.quantity / 100).toFixed(2)}`);
      const total = (this.total() / 100).toFixed(2);
      const msg = `Hola! Quiero comprar:\n\n${lines.join('\n')}\n\nTotal: $${total} USD`;
      window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`, '_blank');
    },

    checkoutTransfer() {
      const items = this.items();
      if (items.length === 0) return;
      const lines = items.map(i => `• ${i.quantity}× ${i.name} — $${(i.price_cents * i.quantity / 100).toFixed(2)}`);
      const total = (this.total() / 100).toFixed(2);
      const msg = `Hola! Quiero pagar por transferencia:\n\n${lines.join('\n')}\n\nTotal: $${total} USD\n\nPor favor envíenme los datos bancarios.`;
      window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`, '_blank');
    }
  };

  function money(cents) {
    return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  async function fetchProducts(params = {}) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${API}/products${qs ? '?' + qs : ''}`);
    const json = await res.json();
    return json.success ? json.data : [];
  }

  async function fetchProduct(slug) {
    const res = await fetch(`${API}/products/${slug}`);
    const json = await res.json();
    return json.success ? json.data : null;
  }

  // Cloudinary URL transformer — inyecta f_auto,q_auto + resize en URLs /image/upload/
  // Idempotente: si la URL ya tiene un segmento de transformación, lo deja como está.
  function cldUrl(url, opts = {}) {
    if (!url || typeof url !== 'string') return url;
    const m = url.match(/^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/);
    if (!m) return url;
    const rest = m[2];
    const first = rest.split('/')[0];
    if (/(^|,)(f_auto|q_auto|w_\d+|c_[a-z]+)(,|$)/.test(first)) return url;
    const parts = [];
    if (opts.w) parts.push(`w_${opts.w}`);
    if (opts.h) parts.push(`h_${opts.h}`);
    if (opts.crop) parts.push(`c_${opts.crop}`);
    if (opts.gravity) parts.push(`g_${opts.gravity}`);
    parts.push(`q_${opts.q || 'auto'}`);
    parts.push(`f_${opts.f || 'auto'}`);
    if (opts.dpr) parts.push(`dpr_${opts.dpr}`);
    return m[1] + parts.join(',') + '/' + rest;
  }

  global.WM = { cart, money, fetchProducts, fetchProduct, cldUrl, API };
  global.cldUrl = cldUrl;
})(window);
