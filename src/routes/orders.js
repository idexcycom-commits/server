const json = (body, status = 200, corsHeaders = {}) => Response.json(body, { status, headers: corsHeaders });

export async function handleOrders(request, env, url, corsHeaders) {
  if (url.pathname === '/api/orders' && request.method === 'POST') {
    try {
      const { userId, razorpay, customer, shipping, items } = await request.json();
      if (!userId || !items || items.length === 0) return json({ success: false, message: 'Invalid order data' }, 400, corsHeaders);
      let total = 0, itemsHtml = '';
      for (const item of items) {
        const product = await env.d1_server.prepare('SELECT * FROM products WHERE id = ?').bind(item.productId).first();
        if (!product) return json({ success: false, message: `Product ${item.productId} not found` }, 404, corsHeaders);
        total += product.price * item.quantity;
        itemsHtml += `<tr><td style="padding:8px;border:1px solid #ddd;">${product.name}</td><td style="padding:8px;border:1px solid #ddd;text-align:center;">${item.quantity}</td><td style="padding:8px;border:1px solid #ddd;text-align:right;">₹${product.price}</td></tr>`;
      }
      const orderResult = await env.d1_server.prepare(`INSERT INTO orders (user_id, razorpay_order_id, razorpay_payment_id, razorpay_signature, amount, customer_name, email, phone, address, city, state, pincode, payment_status, order_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(userId, razorpay.razorpay_order_id, razorpay.razorpay_payment_id, razorpay.razorpay_signature, total, customer.name, customer.email, customer.phone, shipping.address, shipping.city, shipping.state, shipping.pincode, 'Paid', 'Pending').run();
      const orderId = orderResult.meta.last_row_id;
      for (const item of items) {
        const product = await env.d1_server.prepare('SELECT * FROM products WHERE id = ?').bind(item.productId).first();
        await env.d1_server.prepare(`INSERT INTO order_items (order_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)`).bind(orderId, product.id, product.name, item.quantity, product.price).run();
      }
      const payload = { from: 'Idexcy <orders@idexcy.com>', to: [customer.email], cc: ['idexcy.com@gmail.com'], subject: `Your Idexcy Order #${orderId} is Confirmed 🍫`, html: `<div style="font-family:Arial,sans-serif"><h2>Thank you for your order, ${customer.name}! 🍫</h2><p>Your order has been successfully placed and payment has been received.</p><p><strong>Order ID:</strong> #${orderId}</p><p><strong>Payment:</strong> Paid</p><p><strong>Total:</strong> ₹${total}</p><h3>Items</h3><table>${itemsHtml}</table><p>Thank you for choosing Idexcy.</p></div>` };
      await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return json({ success: true, orderId, total, message: 'Order placed successfully' }, 200, corsHeaders);
    } catch (err) { return json({ success: false, error: err.message }, 500, corsHeaders); }
  }

  if (request.method === 'GET' && url.pathname === '/api/orders') {
    const userId = url.searchParams.get('userId');
    if (!userId) return json({ success: false, message: 'User ID is required' }, 400, corsHeaders);
    const orders = await env.d1_server.prepare(`SELECT id, amount, payment_status, order_status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC`).bind(userId).all();
    return json({ success: true, orders: orders.results }, 200, corsHeaders);
  }

  if (request.method === 'PUT' && /^\/api\/orders\/[^/]+$/.test(url.pathname)) {
    try {
      const orderId = url.pathname.split('/').pop();
      const { customer_name, email, phone, address, city, state, pincode } = await request.json();
      const result = await env.d1_server.prepare(`UPDATE orders SET customer_name = ?, email = ?, phone = ?, address = ?, city = ?, state = ?, pincode = ? WHERE id = ?`).bind(customer_name, email, phone, address, city, state, pincode, orderId).run();
      if (result.meta.changes === 0) return json({ success: false, message: 'Order not found' }, 404, corsHeaders);
      return json({ success: true, message: 'Order updated successfully' }, 200, corsHeaders);
    } catch (err) { return json({ success: false, error: err.message }, 500, corsHeaders); }
  }

  if (request.method === 'GET' && /^\/api\/orders\/[^/]+$/.test(url.pathname)) {
    try {
      const orderId = url.pathname.split('/').pop();
      const order = await env.d1_server.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first();
      if (!order) return json({ success: false, message: 'Order not found' }, 404, corsHeaders);
      const items = await env.d1_server.prepare(`SELECT oi.id, oi.product_id, p.name, p.image, oi.quantity, oi.price, (oi.quantity * oi.price) AS subtotal FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?`).bind(orderId).all();
      order.items = items.results;
      return json({ success: true, order }, 200, corsHeaders);
    } catch (err) { return json({ success: false, error: err.message }, 500, corsHeaders); }
  }

  if (request.method === 'GET' && url.pathname === '/api/user/orders') {
    try {
      const userId = url.searchParams.get('userId');
      if (!userId) return json({ success: false, message: 'User ID is required' }, 400, corsHeaders);
      const orders = await env.d1_server.prepare(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`).bind(userId).all();
      for (const order of orders.results) {
        const items = await env.d1_server.prepare(`SELECT oi.id, oi.product_id, p.name, p.image, oi.quantity, oi.price FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?`).bind(order.id).all();
        order.items = items.results;
      }
      return json({ success: true, totalOrders: orders.results.length, orders: orders.results }, 200, corsHeaders);
    } catch (err) { return json({ success: false, error: err.message }, 500, corsHeaders); }
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/orders') {
    try {
      const orders = await env.d1_server.prepare(`SELECT o.id, o.amount, o.payment_status, o.order_status, o.created_at, u.name, u.email FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC`).all();
      return json({ success: true, orders: orders.results }, 200, corsHeaders);
    } catch (err) { return json({ success: false, error: err.message }, 500, corsHeaders); }
  }

  if (request.method === 'PUT' && /^\/api\/admin\/orders\/[^/]+\/status$/.test(url.pathname)) {
    try {
      const orderId = url.pathname.split('/')[4];
      const { order_status } = await request.json();
      const validStatuses = ['Received', 'In Transit', 'Delivered', 'Unable to Reach'];
      if (!validStatuses.includes(order_status)) return json({ success: false, message: 'Invalid order status' }, 400, corsHeaders);
      const order = await env.d1_server.prepare(`SELECT id, customer_name, email, amount, order_status FROM orders WHERE id = ?`).bind(orderId).first();
      if (!order) return json({ success: false, message: 'Order not found' }, 404, corsHeaders);
      const result = await env.d1_server.prepare(`UPDATE orders SET order_status = ? WHERE id = ?`).bind(order_status, orderId).run();
      if (result.meta.changes === 0) return json({ success: false, message: 'Order status was not updated' }, 400, corsHeaders);
      const messages = { Received: "We've received your order and will begin preparing it shortly.", 'In Transit': 'Good news! Your Idexcy order is on its way.', Delivered: 'Your Idexcy order has been delivered. We hope you enjoy every bite.', 'Unable to Reach': 'We were unable to reach you while attempting to deliver your Idexcy order. Our delivery team may try again soon.' };
      let emailSent = false;
      try {
        const resendResponse = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'Idexcy <orders@idexcy.com>', to: [order.email], subject: `Your Idexcy Order #${orderId} Update`, html: `<div style="font-family:Arial,sans-serif"><h1>IDEXCY</h1><p>Hi ${order.customer_name || 'there'},</p><h2>Your order is now ${order_status}</h2><p>${messages[order_status]}</p><p><strong>Order #:</strong> ${order.id}</p><p><strong>Status:</strong> ${order_status}</p><p><strong>Order Total:</strong> ₹${order.amount}</p></div>` }) });
        emailSent = resendResponse.ok;
      } catch (emailError) { console.error('Email sending error:', emailError); }
      return json({ success: true, message: 'Order status updated successfully', orderId, order_status, emailSent }, 200, corsHeaders);
    } catch (err) { console.error('Order status error:', err); return json({ success: false, error: err.message }, 500, corsHeaders); }
  }
  return null;
}
