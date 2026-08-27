const json = (body, status = 200, corsHeaders = {}) => Response.json(body, { status, headers: corsHeaders });

export async function handleUsers(request, env, url, corsHeaders) {
  if (request.method === 'PUT' && /^\/api\/users\/[^/]+$/.test(url.pathname)) {
    try {
      const userId = url.pathname.split('/').pop();
      const { name, email, is_admin } = await request.json();
      if (!name || !email) return json({ success: false, message: 'Name and email are required' }, 400, corsHeaders);
      if (is_admin !== 0 && is_admin !== 1) return json({ success: false, message: 'is_admin must be 0 or 1' }, 400, corsHeaders);
      const existingUser = await env.d1_server.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
      if (!existingUser) return json({ success: false, message: 'User not found' }, 404, corsHeaders);
      const emailUser = await env.d1_server.prepare(`SELECT id FROM users WHERE email = ? AND id != ?`).bind(email, userId).first();
      if (emailUser) return json({ success: false, message: 'Email is already being used by another user' }, 409, corsHeaders);
      await env.d1_server.prepare(`UPDATE users SET name = ?, email = ?, is_admin = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(name, email, is_admin, userId).run();
      return json({ success: true, message: 'User updated successfully', user: { id: userId, name, email, is_admin } }, 200, corsHeaders);
    } catch (err) { console.error('Update user error:', err); return json({ success: false, error: err.message }, 500, corsHeaders); }
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/users') {
    try {
      const users = await env.d1_server.prepare(`SELECT id, name, email, created_at FROM users ORDER BY created_at DESC`).all();
      return json({ success: true, users: users.results }, 200, corsHeaders);
    } catch (err) { return json({ success: false, error: err.message }, 500, corsHeaders); }
  }
  return null;
}
