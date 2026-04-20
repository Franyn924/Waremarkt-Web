# Migración SQLite → MySQL · HANDOFF

**Fecha:** 2026-04-20
**Rama:** `feature/mysql-migration` (NO mergeada a `main` todavía — producción sigue con SQLite hasta que tú lo hagas)

---

## Por qué se hizo esto

Hostinger clona el repo en cada deploy y **borra todo lo que no esté commiteado**. Como `backend/db/waremarkt.db` está en `.gitignore`, cada vez que se empujaba código a `main` se perdía:

- Todos los productos cargados manualmente
- Todas las categorías personalizadas
- Todos los pedidos pagados (incluyendo tu primera compra real)
- Todos los ajustes de la tienda

**Solución:** migrar a MySQL, que vive fuera del filesystem del repo y persiste entre deploys.

---

## Qué cambió en el código

| Archivo | Cambio |
|---|---|
| `backend/package.json` | `better-sqlite3` → `mysql2` |
| `backend/db/schema.js` | Reescrito completo: pool MySQL, `initDb()` crea tablas con sintaxis InnoDB, migra columna `media_json`, siembra categorías y settings |
| `backend/routes/products.js` | `pool.execute` async, `LIMIT` interpolado (sanitizado) |
| `backend/routes/categories.js` | `pool.query` async |
| `backend/routes/settings.js` | `getAllSettings()` async |
| `backend/routes/checkout.js` | Todos los `getSetting` awaitados, INSERT orders con `pool.execute` |
| `backend/routes/webhook.js` | `MAX()` → `GREATEST()` (MySQL), quité `updated_at = CURRENT_TIMESTAMP` manual (ahora es `ON UPDATE` de la columna) |
| `backend/routes/admin.js` | Todo el CRUD async, `sanitize()` async (valida categoría en BD), `result.insertId` / `affectedRows`, `ER_DUP_ENTRY` para duplicados, **settings PUT ahora usa transacción** |
| `backend/server.js` | Bootstrap async: `await initDb()` antes de `app.listen` |
| `backend/.env.example` | Variables MySQL documentadas |

**Nada de la UI (admin.html, tienda.html, etc.) cambió.** La API expone exactamente los mismos endpoints.

---

## Pasos para activar MySQL en Hostinger

### 1. Crear la base de datos

hPanel → **Bases de datos** → **MySQL Databases** → **Crear nueva base de datos**

- Nombre BD: `waremarkt` (quedará como `u000000000_waremarkt`)
- Usuario: `waremarkt_user` (quedará como `u000000000_waremarkt`)
- Contraseña: **genera una fuerte y guárdala**

Anota los 4 datos exactos que te da Hostinger:
- Host (normalmente `localhost`)
- Nombre BD completo (con prefijo `u000000000_`)
- Usuario completo
- Contraseña

### 2. Configurar variables de entorno del Node.js app

hPanel → **Websites → waremarkt.com → Node.js** → **Environment Variables**

Añadir estas (conservar las de Stripe, FRONTEND_URL, ADMIN_TOKEN que ya tenías):

```
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=u000000000_waremarkt
MYSQL_PASSWORD=la_que_generaste
MYSQL_DATABASE=u000000000_waremarkt
```

⚠ **No incluyas comillas** en los valores del panel.

### 3. Mergear la rama a main

Opción A — desde la línea de comandos (en tu PC):
```bash
cd "Web Waremarkt"
git checkout main
git merge feature/mysql-migration
git push origin main
```

Opción B — abrir un Pull Request en GitHub y mergearlo desde la web.

Hostinger detectará el push y redeployará. Al arrancar, `server.js` ejecuta `initDb()` que crea las 4 tablas vacías y siembra 2 categorías + settings por defecto.

### 4. Verificar

- Abre `https://waremarkt.com/api/health` → debe responder `{"success":true,...}`
- Entra a `https://waremarkt.com/admin.html` con tu ADMIN_TOKEN
- Crea un producto de prueba
- **Haz un nuevo deploy (cualquier push)** y confirma que el producto sigue ahí — esta es la prueba real de que MySQL persiste.

### 5. Recuperar datos perdidos

- **Productos / categorías:** hay que volver a cargarlos manualmente (se perdieron con los wipes previos). Si tenías el CSV de Sprouts que mencionaste, cárgalo ahora.
- **Pedido pagado (tu primera compra):** el dinero está en Stripe — ve al [Dashboard de Stripe → Payments](https://dashboard.stripe.com/payments) y busca el session `cs_live_a1MXk...`. Ahí tienes email del cliente, items, monto, dirección de envío. Puedes insertar manualmente ese registro en la tabla `orders` vía phpMyAdmin si quieres historial completo.

---

## Rollback si algo falla

Si el deploy falla y la web se cae:

```bash
git checkout main
git revert -m 1 <commit-del-merge>
git push origin main
```

Eso revierte a SQLite. Perderás otra vez los datos del siguiente deploy, pero la web vuelve a funcionar mientras diagnosticas.

---

## Probado localmente

❌ **No probado en tu máquina** — no tienes MySQL local corriendo. El código compila (syntax OK en todos los archivos), pero la primera ejecución real será en Hostinger.

Si ves errores en los logs del Node.js app de Hostinger al arrancar, pégamelos en el próximo chat.

---

## Archivos obsoletos que se pueden borrar (opcional)

- `backend/db/waremarkt.db*` (si existen localmente) — ya no se usan
- Las líneas `backend/db/waremarkt.db*` del `.gitignore` — se pueden dejar, no estorban

---

## Contacto

Si MySQL no arranca, el error más común es:
- `ECONNREFUSED` → host o puerto mal
- `Access denied` → usuario o password mal (copiados con espacio al inicio?)
- `Unknown database` → el nombre de BD no lleva el prefijo `u000000000_` correcto

Suerte. Si todo sale bien, esta es la última vez que pierdes datos por deploy.
