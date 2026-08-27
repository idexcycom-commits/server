const json = (body, status = 200, corsHeaders = {}) => Response.json(body, { status, headers: corsHeaders });

export async function handleProducts(request, env, url, corsHeaders) {
  if (request.method === 'POST' && url.pathname === '/api/admin/products') {
    try {
      const { name, description, price, stock, image, category } = await request.json();
      if (!name || price == null) return json({ success: false, message: 'Name and price are required' }, 400, corsHeaders);
      const result = await env.d1_server.prepare(`INSERT INTO products (name, description, price, stock, image, category) VALUES (?, ?, ?, ?, ?, ?)`).bind(name, description || '', Number(price), Number(stock || 0), image || '', category || '').run();
      return json({ success: true, message: 'Product added successfully', productId: result.meta.last_row_id }, 200, corsHeaders);
    } catch (err) { return json({ success: false, error: err.message }, 500, corsHeaders); }
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/products') {
    try {
      const products = await env.d1_server.prepare(`SELECT * FROM products ORDER BY id DESC`).all();
      return json({ success: true, products: products.results }, 200, corsHeaders);
    } catch (err) { return json({ success: false, error: err.message }, 500, corsHeaders); }
  }

  if (request.method === 'PUT' && /^\/api\/admin\/products\/[^/]+$/.test(url.pathname)) {
    try {
      const productId = url.pathname.split('/').pop();
      const { name, description, price, stock, image, category } = await request.json();
      const result = await env.d1_server.prepare(`UPDATE products SET name = ?, description = ?, price = ?, stock = ?, image = ?, category = ? WHERE id = ?`).bind(name, description, price, stock, image, category, productId).run();
      if (result.meta.changes === 0) return json({ success: false, message: 'Product not found' }, 404, corsHeaders);
      return json({ success: true, message: 'Product updated successfully' }, 200, corsHeaders);
    } catch (err) { return json({ success: false, error: err.message }, 500, corsHeaders); }
  }
  return null;
}
