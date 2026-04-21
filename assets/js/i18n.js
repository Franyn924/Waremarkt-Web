// Waremarkt i18n — diccionario ES/EN + aplicador de traducciones
(function (global) {
  const LANG_KEY = 'waremarkt_lang';

  const DICT = {
    es: {
      // Header
      'header.tagline': 'Soluciones logísticas inteligentes',
      'nav.home': 'Inicio',
      'nav.catalog': 'Catálogo',
      'nav.products': 'Productos',
      'nav.services': 'Servicios',
      'nav.shipping': 'Envíos',
      'nav.contact': 'Contacto',
      'nav.shop': 'Tienda',
      'nav.shop_full': 'Tienda completa',
      'nav.cart': 'Carrito',
      'nav.buy_now': 'Comprar ahora',
      'nav.whatsapp': 'WhatsApp',
      'nav.cart_aria': 'Carrito',
      'nav.menu_aria': 'Abrir menú',
      'nav.breadcrumb_home': 'Inicio',
      'nav.breadcrumb_shop': 'Tienda',

      // Hero
      'hero.badge': 'Envíos activos a US + LatAm',
      'hero.h1': 'Tecnología que <span class="gradient-text">llega</span>,<br>logística que <span class="gradient-text">piensa</span>.',
      'hero.p': 'Computación, accesorios y soluciones tech entregadas con infraestructura logística inteligente. Compra online, paga con Stripe, WhatsApp o transferencia.',
      'hero.cta_primary': 'Ver catálogo',
      'hero.cta_secondary': 'Hablar por WhatsApp',
      'hero.stat1_label': 'Procesamiento',
      'hero.stat2_label': 'Países LatAm',
      'hero.stat3_label': 'Pagos seguros',
      'hero.mockup_order': 'Orden #WM-2847',
      'hero.mockup_status': 'En tránsito',
      'hero.mockup_p1_name': 'Laptop Gaming',
      'hero.mockup_p1_desc': 'RTX 4060 · 16GB RAM',
      'hero.mockup_p2_name': 'Audífonos Pro',
      'hero.mockup_p2_desc': 'Wireless · Noise cancel',
      'hero.mockup_p3_name': 'Mouse Ergonómico',
      'hero.mockup_p3_desc': 'Bluetooth · 7 botones',
      'hero.mockup_delivery_label': 'Entrega estimada',
      'hero.mockup_delivery_value': '2–5 días hábiles',

      // Categorías
      'cats.kicker': 'Catálogo',
      'cats.h2': 'Categorías pensadas para <span class="text-azul">tu trabajo y tu gaming</span>.',
      'cats.computacion': 'Computación',
      'cats.computacion_count': '18 productos',
      'cats.computacion_desc': 'Laptops, desktops, workstations y componentes para gamers y profesionales.',
      'cats.accesorios': 'Accesorios',
      'cats.accesorios_count': '32 productos',
      'cats.accesorios_desc': 'Teclados, mouses, audífonos, monitores y todo lo que potencia tu setup.',
      'cats.explore': 'Explorar categoría',

      // Destacados
      'featured.kicker': 'Destacados',
      'featured.h2': 'Productos que <span class="text-azul">se mueven rápido</span>.',
      'featured.see_all': 'Ver todo el catálogo',
      'featured.add': 'Añadir',
      'featured.added': 'Añadido',

      // Cómo comprar
      'pay.kicker': 'Formas de pago',
      'pay.h2': 'Tres maneras de comprar,<br><span class="gradient-text">una experiencia fluida</span>.',
      'pay.card_title': 'Tarjeta con Stripe',
      'pay.card_desc': 'Checkout seguro con Visa, Mastercard, Amex y billeteras digitales. Confirmación inmediata y tracking al instante.',
      'pay.card_feat1': 'Pago encriptado SSL',
      'pay.card_feat2': 'Confirmación en segundos',
      'pay.wa_title': 'WhatsApp Business',
      'pay.wa_desc': 'Escríbenos y cerramos la compra con atención humana. Ideal si necesitas asesoría antes de pagar.',
      'pay.wa_feat1': 'Asesor en tiempo real',
      'pay.wa_feat2': '+1 407 943 4098',
      'pay.tr_title': 'Transferencia',
      'pay.tr_desc': 'Pago directo por ACH o wire transfer. Enviamos datos bancarios tras confirmar tu pedido.',
      'pay.tr_feat1': 'ACH / Wire disponible',
      'pay.tr_feat2': 'Envío al confirmar',

      // Envíos
      'ship.kicker': 'Cobertura',
      'ship.h2': 'Infraestructura logística <span class="text-azul">US ↔ LatAm</span>.',
      'ship.p': 'Envíos consolidados desde Florida con redistribución a más de 20 países. Tracking en tiempo real desde el pago hasta tu puerta.',
      'ship.hub_title': 'Hub central en Florida',
      'ship.hub_desc': 'Procesamiento en 24h desde recepción del pedido.',
      'ship.routes_title': 'Rutas aéreas y marítimas',
      'ship.routes_desc': 'Eliges velocidad vs costo según tu urgencia.',
      'ship.track_title': 'Tracking end-to-end',
      'ship.track_desc': 'Código único y notificaciones por cada etapa.',
      'ship.coverage_label': 'Cobertura activa',
      'ship.countries_suffix': 'países',
      'ship.more_countries': '13 más',
      'ship.avg_time': 'Tiempo promedio: 2-7 días hábiles',

      // CTA final
      'cta.h2': '¿Listo para equipar tu setup?',
      'cta.p': 'Escríbenos por WhatsApp o revisa el catálogo. Respondemos en minutos y enviamos a toda América.',
      'cta.wa': 'Escribir por WhatsApp',

      // Footer
      'footer.tagline': 'Soluciones logísticas',
      'footer.desc': 'Tecnología y logística inteligente para US y Latinoamérica.',
      'footer.shop_title': 'Tienda',
      'footer.shop_comp': 'Computación',
      'footer.shop_acc': 'Accesorios',
      'footer.shop_offers': 'Ofertas',
      'footer.shop_new': 'Novedades',
      'footer.support_title': 'Soporte',
      'footer.support_tracking': 'Envíos y tracking',
      'footer.support_payments': 'Formas de pago',
      'footer.support_returns': 'Devoluciones',
      'footer.support_faq': 'Preguntas frecuentes',
      'footer.contact_title': 'Contáctanos',
      'footer.newsletter_title': 'Ofertas al instante',
      'footer.newsletter_desc': 'Suscríbete y recibe descuentos exclusivos antes que nadie.',
      'footer.newsletter_placeholder': 'tu@email.com',
      'footer.newsletter_button': 'Suscribirme',
      'footer.rights': '© 2026 Waremarkt. Todos los derechos reservados.',
      'footer.privacy': 'Privacidad',
      'footer.terms': 'Términos',
      'footer.cookies': 'Cookies',

      // Tienda
      'shop.h1': 'Catálogo completo',
      'shop.subtitle': 'Computación y accesorios con envíos a US y LatAm.',
      'shop.all': 'Todos',
      'shop.loading': 'Cargando productos...',
      'shop.empty': 'No hay productos en esta categoría.',
      'shop.add': 'Añadir',
      'shop.added': 'Añadido',
      'shop.add_cart': 'Añadir al carrito',
      'shop.products_label': 'productos',
      'shop.toast_added': 'añadido',

      // Producto
      'prod.loading': 'Cargando...',
      'prod.not_found': 'Producto no encontrado',
      'prod.back': 'Volver al catálogo',
      'prod.in_stock': 'En stock',
      'prod.available': 'disponibles',
      'prod.out_of_stock': 'Sin stock',
      'prod.add_cart': 'Añadir al carrito',
      'prod.ask_wa': 'Consultar por WhatsApp',
      'prod.share': 'Compartir producto',
      'prod.share_email': 'Correo',
      'prod.share_copy': 'Copiar enlace',
      'prod.share_copied': 'Enlace copiado al portapapeles',
      'prod.share_copy_fail': 'No se pudo copiar el enlace',
      'prod.ship_title': 'Envío US + LatAm',
      'prod.ship_desc': '2–7 días hábiles',
      'prod.secure_title': 'Pago seguro',
      'prod.secure_desc': 'Stripe SSL',
      'prod.return_title': 'Devolución',
      'prod.return_desc': '30 días',
      'prod.track_title': 'Tracking',
      'prod.track_desc': 'En tiempo real',

      // Carrito
      'cart.h1': 'Tu carrito',
      'cart.empty_title': 'Tu carrito está vacío',
      'cart.empty_desc': 'Explora el catálogo y añade productos.',
      'cart.go_catalog': 'Ir al catálogo',
      'cart.summary': 'Resumen',
      'cart.subtotal': 'Subtotal',
      'cart.shipping': 'Envío',
      'cart.shipping_value': 'Calculado al pagar',
      'cart.total': 'Total',
      'cart.pay_stripe': 'Pagar con tarjeta (Stripe)',
      'cart.pay_stripe_loading': 'Redirigiendo...',
      'cart.pay_wa': 'WhatsApp',
      'cart.pay_tr': 'Transferencia',
      'cart.secure': 'Pago seguro con SSL',
      'cart.coverage': 'Envío a US + 19 países LatAm',
      'cart.returns': '30 días para devolución',
      'cart.remove_aria': 'Eliminar',

      // Success / Cancel
      'success.title': '¡Pago confirmado!',
      'success.desc': 'Recibirás un email con los detalles de tu orden y el tracking cuando tu pedido salga del hub de Florida.',
      'success.continue': 'Seguir comprando',
      'success.help': '¿Necesitas ayuda? Escríbenos al',
      'cancel.title': 'Pago cancelado',
      'cancel.desc': 'Tu carrito sigue intacto. Puedes reintentar el pago o probar otra forma (WhatsApp o transferencia).',
      'cancel.retry': 'Volver al carrito',
      'cancel.catalog': 'Seguir explorando'
    },
    en: {
      // Header
      'header.tagline': 'Smart logistics solutions',
      'nav.home': 'Home',
      'nav.catalog': 'Catalog',
      'nav.products': 'Products',
      'nav.services': 'Services',
      'nav.shipping': 'Shipping',
      'nav.contact': 'Contact',
      'nav.shop': 'Shop',
      'nav.shop_full': 'Full shop',
      'nav.cart': 'Cart',
      'nav.buy_now': 'Shop now',
      'nav.whatsapp': 'WhatsApp',
      'nav.cart_aria': 'Cart',
      'nav.menu_aria': 'Open menu',
      'nav.breadcrumb_home': 'Home',
      'nav.breadcrumb_shop': 'Shop',

      // Hero
      'hero.badge': 'Active shipping to US + LatAm',
      'hero.h1': 'Tech that <span class="gradient-text">arrives</span>,<br>logistics that <span class="gradient-text">thinks</span>.',
      'hero.p': 'Computers, accessories and tech solutions delivered with smart logistics infrastructure. Shop online, pay with Stripe, WhatsApp or bank transfer.',
      'hero.cta_primary': 'Browse catalog',
      'hero.cta_secondary': 'Chat on WhatsApp',
      'hero.stat1_label': 'Processing',
      'hero.stat2_label': 'LatAm countries',
      'hero.stat3_label': 'Secure payments',
      'hero.mockup_order': 'Order #WM-2847',
      'hero.mockup_status': 'In transit',
      'hero.mockup_p1_name': 'Gaming Laptop',
      'hero.mockup_p1_desc': 'RTX 4060 · 16GB RAM',
      'hero.mockup_p2_name': 'Pro Headphones',
      'hero.mockup_p2_desc': 'Wireless · Noise cancel',
      'hero.mockup_p3_name': 'Ergonomic Mouse',
      'hero.mockup_p3_desc': 'Bluetooth · 7 buttons',
      'hero.mockup_delivery_label': 'Estimated delivery',
      'hero.mockup_delivery_value': '2–5 business days',

      // Categories
      'cats.kicker': 'Catalog',
      'cats.h2': 'Categories built for <span class="text-azul">your work and your gaming</span>.',
      'cats.computacion': 'Computers',
      'cats.computacion_count': '18 products',
      'cats.computacion_desc': 'Laptops, desktops, workstations and components for gamers and professionals.',
      'cats.accesorios': 'Accessories',
      'cats.accesorios_count': '32 products',
      'cats.accesorios_desc': 'Keyboards, mice, headphones, monitors and everything that powers your setup.',
      'cats.explore': 'Explore category',

      // Featured
      'featured.kicker': 'Featured',
      'featured.h2': 'Products that <span class="text-azul">move fast</span>.',
      'featured.see_all': 'View full catalog',
      'featured.add': 'Add',
      'featured.added': 'Added',

      // How to buy
      'pay.kicker': 'Payment methods',
      'pay.h2': 'Three ways to buy,<br><span class="gradient-text">one smooth experience</span>.',
      'pay.card_title': 'Card via Stripe',
      'pay.card_desc': 'Secure checkout with Visa, Mastercard, Amex and digital wallets. Instant confirmation and tracking.',
      'pay.card_feat1': 'SSL encrypted payment',
      'pay.card_feat2': 'Confirmation in seconds',
      'pay.wa_title': 'WhatsApp Business',
      'pay.wa_desc': 'Message us and we close the sale with human support. Ideal if you need guidance before paying.',
      'pay.wa_feat1': 'Real-time agent',
      'pay.wa_feat2': '+1 407 943 4098',
      'pay.tr_title': 'Bank transfer',
      'pay.tr_desc': 'Direct payment via ACH or wire transfer. We send bank details after confirming your order.',
      'pay.tr_feat1': 'ACH / Wire available',
      'pay.tr_feat2': 'Ships upon confirmation',

      // Shipping
      'ship.kicker': 'Coverage',
      'ship.h2': 'Logistics infrastructure <span class="text-azul">US ↔ LatAm</span>.',
      'ship.p': 'Consolidated shipments from Florida with redistribution to over 20 countries. Real-time tracking from payment to doorstep.',
      'ship.hub_title': 'Central hub in Florida',
      'ship.hub_desc': '24h processing from order receipt.',
      'ship.routes_title': 'Air and sea routes',
      'ship.routes_desc': 'Choose speed vs cost based on your urgency.',
      'ship.track_title': 'End-to-end tracking',
      'ship.track_desc': 'Unique code and notifications at every stage.',
      'ship.coverage_label': 'Active coverage',
      'ship.countries_suffix': 'countries',
      'ship.more_countries': '13 more',
      'ship.avg_time': 'Average time: 2-7 business days',

      // Final CTA
      'cta.h2': 'Ready to equip your setup?',
      'cta.p': "Message us on WhatsApp or browse the catalog. We reply in minutes and ship across the Americas.",
      'cta.wa': 'Chat on WhatsApp',

      // Footer
      'footer.tagline': 'Logistics solutions',
      'footer.desc': 'Smart tech and logistics for the US and Latin America.',
      'footer.shop_title': 'Shop',
      'footer.shop_comp': 'Computers',
      'footer.shop_acc': 'Accessories',
      'footer.shop_offers': 'Deals',
      'footer.shop_new': 'New arrivals',
      'footer.support_title': 'Support',
      'footer.support_tracking': 'Shipping & tracking',
      'footer.support_payments': 'Payment methods',
      'footer.support_returns': 'Returns',
      'footer.support_faq': 'FAQ',
      'footer.contact_title': 'Contact us',
      'footer.newsletter_title': 'Instant deals',
      'footer.newsletter_desc': 'Subscribe and get exclusive discounts before anyone else.',
      'footer.newsletter_placeholder': 'you@email.com',
      'footer.newsletter_button': 'Subscribe',
      'footer.rights': '© 2026 Waremarkt. All rights reserved.',
      'footer.privacy': 'Privacy',
      'footer.terms': 'Terms',
      'footer.cookies': 'Cookies',

      // Shop
      'shop.h1': 'Full catalog',
      'shop.subtitle': 'Computers and accessories shipped to the US and LatAm.',
      'shop.all': 'All',
      'shop.loading': 'Loading products...',
      'shop.empty': 'No products in this category.',
      'shop.add': 'Add',
      'shop.added': 'Added',
      'shop.add_cart': 'Add to cart',
      'shop.products_label': 'products',
      'shop.toast_added': 'added',

      // Product
      'prod.loading': 'Loading...',
      'prod.not_found': 'Product not found',
      'prod.back': 'Back to catalog',
      'prod.in_stock': 'In stock',
      'prod.available': 'available',
      'prod.out_of_stock': 'Out of stock',
      'prod.add_cart': 'Add to cart',
      'prod.ask_wa': 'Ask on WhatsApp',
      'prod.share': 'Share product',
      'prod.share_email': 'Email',
      'prod.share_copy': 'Copy link',
      'prod.share_copied': 'Link copied to clipboard',
      'prod.share_copy_fail': 'Could not copy link',
      'prod.ship_title': 'US + LatAm shipping',
      'prod.ship_desc': '2–7 business days',
      'prod.secure_title': 'Secure payment',
      'prod.secure_desc': 'Stripe SSL',
      'prod.return_title': 'Returns',
      'prod.return_desc': '30 days',
      'prod.track_title': 'Tracking',
      'prod.track_desc': 'Real-time',

      // Cart
      'cart.h1': 'Your cart',
      'cart.empty_title': 'Your cart is empty',
      'cart.empty_desc': 'Browse the catalog and add products.',
      'cart.go_catalog': 'Go to catalog',
      'cart.summary': 'Summary',
      'cart.subtotal': 'Subtotal',
      'cart.shipping': 'Shipping',
      'cart.shipping_value': 'Calculated at checkout',
      'cart.total': 'Total',
      'cart.pay_stripe': 'Pay with card (Stripe)',
      'cart.pay_stripe_loading': 'Redirecting...',
      'cart.pay_wa': 'WhatsApp',
      'cart.pay_tr': 'Bank transfer',
      'cart.secure': 'Secure SSL payment',
      'cart.coverage': 'Shipping to US + 19 LatAm countries',
      'cart.returns': '30-day returns',
      'cart.remove_aria': 'Remove',

      // Success / Cancel
      'success.title': 'Payment confirmed!',
      'success.desc': "You'll receive an email with your order details and tracking when your package leaves our Florida hub.",
      'success.continue': 'Continue shopping',
      'success.help': 'Need help? Message us on WhatsApp.',
      'cancel.title': 'Payment canceled',
      'cancel.desc': 'Your cart is still intact. You can retry the payment or try another method (WhatsApp or bank transfer).',
      'cancel.retry': 'Back to cart',
      'cancel.catalog': 'Keep browsing'
    }
  };

  function get() {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === 'es' || stored === 'en') return stored;
    const browser = (navigator.language || 'es').slice(0, 2).toLowerCase();
    return browser === 'en' ? 'en' : 'es';
  }

  function set(lang) {
    if (lang !== 'es' && lang !== 'en') return;
    localStorage.setItem(LANG_KEY, lang);
    apply();
    window.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang } }));
  }

  function t(key) {
    const lang = get();
    return (DICT[lang] && DICT[lang][key]) || DICT.es[key] || key;
  }

  function apply() {
    const lang = get();
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.dataset.i18nTitle);
    });
    document.querySelectorAll('[data-lang-switch]').forEach(el => {
      el.textContent = lang === 'es' ? 'EN' : 'ES';
      el.title = lang === 'es' ? 'Switch to English' : 'Cambiar a español';
    });
  }

  function toggle() {
    set(get() === 'es' ? 'en' : 'es');
  }

  global.WMi18n = { get, set, t, apply, toggle, DICT };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})(window);
