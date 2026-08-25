const corsHeaders = {
	'Access-Control-Allow-Origin': 'https://idexcy.com',
	'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function verifyEmail(request, env) {
	try {
		const { email, code } = await request.json();

		if (!email || !code) {
			return Response.json(
				{
					success: false,
					message: 'Email and verification code are required.',
				},
				{ status: 400 },
			);
		}

		// Find verification record
		const verification = await env.d1_server
			.prepare(
				`
            SELECT *
            FROM email_verifications
            WHERE email = ?
            AND code = ?
        `,
			)
			.bind(email, code)
			.first();

		if (!verification) {
			return Response.json(
				{
					success: false,
					message: 'Invalid verification code.',
				},
				{ status: 400 },
			);
		}

		// Check expiry
		if (new Date(verification.expires_at) < new Date()) {
			// Remove expired code
			await env.DB.prepare(
				`
                DELETE FROM email_verifications
                WHERE id = ?
            `,
			)
				.bind(verification.id)
				.run();

			return Response.json(
				{
					success: false,
					message: 'Verification code has expired.',
				},
				{ status: 400 },
			);
		}

		// Mark email as verified
		await env.d1_server
			.prepare(
				`
            UPDATE users
            SET email_verified = 1
            WHERE id = ?
        `,
			)
			.bind(verification.user_id)
			.run();

		// Delete OTP
		await env.d1_server
			.prepare(
				`
            DELETE FROM email_verifications
            WHERE user_id = ?
        `,
			)
			.bind(verification.user_id)
			.run();

		return Response.json({
			success: true,
			message: 'Email verified successfully.',
		});
	} catch (err) {
		console.error(err);

		return Response.json(
			{
				success: false,
				message: 'Internal server error.',
			},
			{ status: 500 },
		);
	}
}
export default {
	async fetch(request, env) {
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}

		const url = new URL(request.url);

		if (url.pathname === '/api/verify-email' && request.method === 'POST') {
			return verifyEmail(request, env);
		}

		const PBKDF2_ITERATIONS = 100000;

		function bytesToBase64(bytes) {
			let binary = '';
			for (const byte of bytes) binary += String.fromCharCode(byte);
			return btoa(binary);
		}

		function base64ToBytes(value) {
			const binary = atob(value);
			return Uint8Array.from(binary, (char) => char.charCodeAt(0));
		}

		async function hashPassword(password) {
			const salt = crypto.getRandomValues(new Uint8Array(16));

			const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);

			const derivedBits = await crypto.subtle.deriveBits(
				{
					name: 'PBKDF2',
					salt,
					iterations: PBKDF2_ITERATIONS,
					hash: 'SHA-256',
				},
				keyMaterial,
				256,
			);

			return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(derivedBits))}`;
		}

		async function verifyPassword(password, storedHash) {
			if (!storedHash?.startsWith('pbkdf2$')) {
				return false;
			}

			const [, iterations, saltBase64, hashBase64] = storedHash.split('$');

			const salt = base64ToBytes(saltBase64);

			const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);

			const derivedBits = await crypto.subtle.deriveBits(
				{
					name: 'PBKDF2',
					salt,
					iterations: Number(iterations),
					hash: 'SHA-256',
				},
				keyMaterial,
				256,
			);

			const derived = new Uint8Array(derivedBits);
			const expected = base64ToBytes(hashBase64);

			if (derived.length !== expected.length) return false;

			let difference = 0;

			for (let i = 0; i < derived.length; i++) {
				difference |= derived[i] ^ expected[i];
			}

			return difference === 0;
		}

		if (request.method === 'POST' && url.pathname === '/api/register') {
			try {
				const { name, email, password } = await request.json();

				// Validate input
				if (!name || !email || !password) {
					return Response.json(
						{
							success: false,
							message: 'Name, email and password are required.',
						},
						{
							status: 400,
							headers: corsHeaders,
						},
					);
				}

				// TODO: Replace with a proper password hash
				// const passwordHash = password;
				const passwordHash = await hashPassword(password);
				// Check if user already exists
				const existingUser = await env.d1_server.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();

				if (existingUser) {
					return Response.json(
						{
							success: false,
							message: 'Email is already registered.',
						},
						{
							status: 409,
							headers: corsHeaders,
						},
					);
				}

				// Insert user
				const insertUser = await env.d1_server
					.prepare(
						`
        INSERT INTO users (name, email, password_hash)
        VALUES (?, ?, ?)
      `,
					)
					.bind(name, email, passwordHash)
					.run();

				const userId = insertUser.meta.last_row_id;

				// Generate 6-digit OTP
				const code = Math.floor(100000 + Math.random() * 900000).toString();

				// Expiry = 10 minutes
				const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

				// Delete old OTPs (just in case)
				await env.d1_server
					.prepare(
						`
        DELETE FROM email_verifications
        WHERE email = ?
      `,
					)
					.bind(email)
					.run();

				// Save OTP
				await env.d1_server
					.prepare(
						`
        INSERT INTO email_verifications
        (user_id, email, code, expires_at)
        VALUES (?, ?, ?, ?)
      `,
					)
					.bind(userId, email, code, expires)
					.run();

				// Send Email
				const payload = {
					from: 'Idexcy <orders@idexcy.com>',
					to: [email],
					subject: 'Verify your Email',
					html: `
        <div style="font-family:Arial,sans-serif">
          <h2>Welcome to Idexcy</h2>

          <p>Thank you for creating your account.</p>

          <p>Your verification code is:</p>

          <h1 style="letter-spacing:5px;">
            ${code}
          </h1>

          <p>This code will expire in <strong>10 minutes</strong>.</p>

          <p>If you didn't create this account, you can safely ignore this email.</p>
        </div>
      `,
				};

				const resendResponse = await fetch('https://api.resend.com/emails', {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${env.RESEND_API_KEY}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(payload),
				});

				if (!resendResponse.ok) {
					console.error(await resendResponse.text());

					return Response.json(
						{
							success: false,
							message: 'Failed to send verification email.',
						},
						{
							status: 500,
							headers: corsHeaders,
						},
					);
				}

				return Response.json(
					{
						success: true,
						message: 'Registration successful. Please verify your email.',
						requiresVerification: true,
					},
					{
						headers: corsHeaders,
					},
				);
			} catch (err) {
				console.error(err);

				return Response.json(
					{
						success: false,
						message: err.message,
					},
					{
						status: 500,
						headers: corsHeaders,
					},
				);
			}
		}

		if (request.method === 'POST' && url.pathname === '/api/login') {
			const { email, password } = await request.json();

			const user = await env.d1_server
				.prepare('SELECT id, name, email,  is_admin,  password_hash FROM users WHERE email = ?')
				.bind(email)
				.first();

			if (!user) {
				return Response.json(
					{
						success: false,
						message: 'Invalid email or password',
					},
					{
						status: 401,
						headers: corsHeaders,
					},
				);
			}
			const passwordValid = await verifyPassword(password, user.password_hash);

			if (!passwordValid) {
				return Response.json(
					{
						success: false,
						message: 'Invalid email or password',
					},
					{ status: 401, headers: corsHeaders },
				);
			}

			return Response.json(
				{
					success: true,
					user: {
						id: user.id,
						name: user.name,
						email: user.email,
						is_admin: user.is_admin,
					},
				},
				{
					headers: corsHeaders,
				},
			);
		}

		if (request.method === 'POST' && url.pathname === '/api/orders') {
			try {
				const { userId, razorpay, customer, shipping, items } = await request.json();

				if (!userId || !items || items.length === 0) {
					return Response.json(
						{
							success: false,
							message: 'Invalid order data',
						},
						{
							status: 400,
							headers: corsHeaders,
						},
					);
				}

				let total = 0;
				let itemsHtml = '';

				for (const item of items) {
					const product = await env.d1_server.prepare('SELECT * FROM products WHERE id = ?').bind(item.productId).first();

					if (!product) {
						return Response.json(
							{
								success: false,
								message: `Product ${item.productId} not found`,
							},
							{
								status: 404,
								headers: corsHeaders,
							},
						);
					}

					total += product.price * item.quantity;

					itemsHtml += `
    <tr>
      <td style="padding:8px;border:1px solid #ddd;">${product.name}</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:center;">${item.quantity}</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;">
        ₹${product.price}
      </td>
    </tr>
  `;
				}

				// Create Order
				const orderResult = await env.d1_server
					.prepare(
						`
    INSERT INTO orders (
      user_id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      amount,
      customer_name,
      email,
      phone,
      address,
      city,
      state,
      pincode,
      payment_status,
      order_status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
					)
					.bind(
						userId,
						razorpay.razorpay_order_id,
						razorpay.razorpay_payment_id,
						razorpay.razorpay_signature,
						total,
						customer.name,
						customer.email,
						customer.phone,
						shipping.address,
						shipping.city,
						shipping.state,
						shipping.pincode,
						'Paid',
						'Pending',
					)
					.run();

				const orderId = orderResult.meta.last_row_id;

				// Save order items
				for (const item of items) {
					const product = await env.d1_server.prepare('SELECT * FROM products WHERE id = ?').bind(item.productId).first();

					await env.d1_server
						.prepare(
							`
                INSERT INTO order_items (
                  order_id,
                  product_id,
                  product_name,
                  quantity,
                  price
                )
                VALUES (?, ?, ?, ?, ?)
              `,
						)
						.bind(orderId, product.id, product.name, item.quantity, product.price)
						.run();
				}

				const payload = {
					from: 'Idexcy <orders@idexcy.com>',
					to: [customer.email],
					cc: ['idexcy.com@gmail.com'],
					subject: `Your Idexcy Order #${orderId} is Confirmed 🍫`,
					html: `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Order Confirmation</title>
</head>

<body style="margin:0;padding:0;background:#F8F4EF;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F4EF;padding:40px 20px;">
<tr>
<td align="center">

<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 8px 25px rgba(0,0,0,0.08);">

<tr>
<td style="background:#2B1B14;padding:40px;text-align:center;">

<h1 style="margin:0;color:#ffffff;font-size:34px;letter-spacing:3px;">
IDEXCY
</h1>

<p style="margin-top:10px;color:#E8DDD3;">
Clean Chocolate. Nothing to Hide.
</p>

</td>
</tr>

<tr>
<td style="padding:40px;">

<h2 style="margin:0;color:#2B1B14;">
Thank you for your order, ${customer.name}! 🍫
</h2>

<p style="margin-top:20px;color:#555;font-size:16px;line-height:1.8;">
Your order has been successfully placed and payment has been received.
We're now preparing your chocolate with care.
</p>

</td>
</tr>

<tr>
<td style="padding:0 40px;">

<table width="100%" cellpadding="12" cellspacing="0" style="background:#FCFAF8;border:1px solid #E5DDD5;border-radius:10px;">

<tr>
<td><strong>Order ID</strong></td>
<td align="right">#${orderId}</td>
</tr>

<tr>
<td><strong>Payment</strong></td>
<td align="right" style="color:#1B8A3D;">Paid</td>
</tr>

<tr>
<td><strong>Total</strong></td>
<td align="right" style="font-size:22px;font-weight:bold;color:#2B1B14;">
₹${total}
</td>
</tr>

</table>

</td>
</tr>

<tr>
<td style="padding:40px;">

<h3 style="margin-top:0;color:#2B1B14;">
Order Summary
</h3>

<table width="100%" cellspacing="0" cellpadding="12" style="border-collapse:collapse;">

<tr style="background:#F2ECE6;">
<th align="left">Product</th>
<th align="center">Qty</th>
<th align="right">Price</th>
</tr>

${itemsHtml}

</table>

</td>
</tr>

<tr>
<td style="padding:0 40px 40px;">

<h3 style="color:#2B1B14;">
Shipping Address
</h3>

<p style="color:#555;line-height:1.8;">
${shipping.address}<br>
${shipping.city}, ${shipping.state}<br>
${shipping.pincode}
</p>

</td>
</tr>

<tr>
<td style="padding:0 40px 40px;">

<div style="background:#FFF8E8;border-left:4px solid #C8A96A;padding:20px;border-radius:8px;">

<strong>What's next?</strong>

<p style="margin-top:12px;line-height:1.8;color:#555;">
Our team will carefully prepare your order and send you another email as soon as it's shipped.
</p>

</div>

</td>
</tr>

<tr>
<td style="background:#2B1B14;padding:40px;text-align:center;">

<p style="color:#ffffff;font-size:24px;margin:0;">
Thank You ❤️
</p>

<p style="margin-top:20px;color:#DCCFC4;line-height:1.8;">
Thank you for choosing Idexcy.<br>
We're grateful to be part of your journey toward cleaner, better chocolate.
</p>

<a href="https://idexcy.com"
style="
display:inline-block;
margin-top:20px;
padding:14px 30px;
background:#ffffff;
color:#2B1B14;
text-decoration:none;
border-radius:8px;
font-weight:bold;
">
Visit Idexcy
</a>

<p style="margin-top:30px;color:#A89C92;font-size:13px;">
© ${new Date().getFullYear()} Idexcy<br>
Questions? Just reply to this email.
</p>

</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`,
				};

				const emailResponse = await fetch('https://api.resend.com/emails', {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${env.RESEND_API_KEY}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(payload),
				});

				const emailText = await emailResponse.text();

				return Response.json({
					customerEmail: customer.email,
					payload,
					resendStatus: emailResponse.status,
					resendResponse: emailText,
				});
				return Response.json(
					{
						success: true,
						orderId,
						total,
						message: 'Order placed successfully',
					},
					{
						headers: corsHeaders,
					},
				);
			} catch (err) {
				return Response.json(
					{
						success: false,
						error: err.message,
					},
					{
						status: 500,
						headers: corsHeaders,
					},
				);
			}
		}

		if (request.method === 'POST' && url.pathname === '/api/admin/products') {
			try {
				const { name, description, price, stock, image, category } = await request.json();

				// Validation
				if (!name || price == null) {
					return Response.json(
						{
							success: false,
							message: 'Name and price are required',
						},
						{
							status: 400,
							headers: corsHeaders,
						},
					);
				}

				const result = await env.d1_server
					.prepare(
						`
        INSERT INTO products
        (name, description, price, stock, image, category)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
					)
					.bind(name, description || '', Number(price), Number(stock || 0), image || '', category || '')
					.run();

				return Response.json(
					{
						success: true,
						message: 'Product added successfully',
						productId: result.meta.last_row_id,
					},
					{
						headers: corsHeaders,
					},
				);
			} catch (err) {
				return Response.json(
					{
						success: false,
						error: err.message,
					},
					{
						status: 500,
						headers: corsHeaders,
					},
				);
			}
		}

		if (request.method === 'GET' && url.pathname === '/api/check-resend') {
			return Response.json({
				keyExists: !!env.RESEND_API_KEY,
				keyPrefix: env.RESEND_API_KEY?.substring(0, 8),
			});
		}

		if (request.method === 'GET' && url.pathname === '/api/orders') {
			const userId = url.searchParams.get('userId');

			const orders = await env.d1_server
				.prepare(
					`
            SELECT
                id,
                amount,
                payment_status,
                order_status,
                created_at
            FROM orders
            WHERE user_id = ?
            ORDER BY created_at DESC
        `,
				)
				.bind(userId)
				.all();

			return Response.json(
				{
					success: true,
					orders: orders.results,
				},
				{
					headers: corsHeaders,
				},
			);
		}
		if (request.method === 'PUT' && url.pathname.startsWith('/api/orders/')) {
			try {
				const orderId = url.pathname.split('/').pop();

				const { customer_name, email, phone, address, city, state, pincode } = await request.json();

				const result = await env.d1_server
					.prepare(
						`
        UPDATE orders
        SET
          customer_name = ?,
          email = ?,
          phone = ?,
          address = ?,
          city = ?,
          state = ?,
          pincode = ?
        WHERE id = ?
      `,
					)
					.bind(customer_name, email, phone, address, city, state, pincode, orderId)
					.run();

				if (result.meta.changes === 0) {
					return Response.json(
						{
							success: false,
							message: 'Order not found',
						},
						{
							status: 404,
							headers: corsHeaders,
						},
					);
				}

				return Response.json(
					{
						success: true,
						message: 'Order updated successfully',
					},
					{
						headers: corsHeaders,
					},
				);
			} catch (err) {
				return Response.json(
					{
						success: false,
						error: err.message,
					},
					{
						status: 500,
						headers: corsHeaders,
					},
				);
			}
		}

		if (request.method === 'PUT' && url.pathname.startsWith('/api/users/')) {
			try {
				const userId = url.pathname.split('/').pop();

				const { name, email, is_admin } = await request.json();

				// Validate required fields
				if (!name || !email) {
					return Response.json(
						{
							success: false,
							message: 'Name and email are required',
						},
						{
							status: 400,
							headers: corsHeaders,
						},
					);
				}

				// Validate is_admin
				if (is_admin !== 0 && is_admin !== 1) {
					return Response.json(
						{
							success: false,
							message: 'is_admin must be 0 or 1',
						},
						{
							status: 400,
							headers: corsHeaders,
						},
					);
				}

				// Check if user exists
				const existingUser = await env.d1_server
					.prepare(
						`
        SELECT id
        FROM users
        WHERE id = ?
      `,
					)
					.bind(userId)
					.first();

				if (!existingUser) {
					return Response.json(
						{
							success: false,
							message: 'User not found',
						},
						{
							status: 404,
							headers: corsHeaders,
						},
					);
				}

				// Check if email is already used by another user
				const emailUser = await env.d1_server
					.prepare(
						`
        SELECT id
        FROM users
        WHERE email = ?
        AND id != ?
      `,
					)
					.bind(email, userId)
					.first();

				if (emailUser) {
					return Response.json(
						{
							success: false,
							message: 'Email is already being used by another user',
						},
						{
							status: 409,
							headers: corsHeaders,
						},
					);
				}

				// Update user
				await env.d1_server
					.prepare(
						`
        UPDATE users
        SET
          name = ?,
          email = ?,
          is_admin = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
					)
					.bind(name, email, is_admin, userId)
					.run();

				return Response.json(
					{
						success: true,
						message: 'User updated successfully',
						user: {
							id: userId,
							name,
							email,
							is_admin,
						},
					},
					{
						headers: corsHeaders,
					},
				);
			} catch (err) {
				console.error('Update user error:', err);

				return Response.json(
					{
						success: false,
						error: err.message,
					},
					{
						status: 500,
						headers: corsHeaders,
					},
				);
			}
		}

		if (request.method === 'GET' && url.pathname === '/api/admin/users') {
			try {
				const users = await env.d1_server
					.prepare(
						`
    SELECT
      id,
      name,
      email,
      created_at
    FROM users
    ORDER BY created_at DESC
  `,
					)
					.all();

				return Response.json(
					{
						success: true,
						users: users.results,
					},
					{
						headers: corsHeaders,
					},
				);
			} catch (err) {
				return Response.json(
					{
						success: false,
						error: err.message,
					},
					{
						status: 500,
						headers: corsHeaders,
					},
				);
			}
		}

		if (request.method === 'GET' && url.pathname === '/api/admin/products') {
			try {
				const products = await env.d1_server
					.prepare(
						`
        SELECT *
        FROM products
        ORDER BY id DESC
      `,
					)
					.all();

				return Response.json(
					{
						success: true,
						products: products.results,
					},
					{
						headers: corsHeaders,
					},
				);
			} catch (err) {
				return Response.json(
					{
						success: false,
						error: err.message,
					},
					{
						status: 500,
						headers: corsHeaders,
					},
				);
			}
		}

		if (request.method === 'GET' && url.pathname === '/api/admin/orders') {
			try {
				const orders = await env.d1_server
					.prepare(
						`
        SELECT

          o.id,
          o.amount,
          o.payment_status,
          o.order_status,
          o.created_at,

          u.name,
          u.email
     

        FROM orders o

        JOIN users u
        ON o.user_id = u.id

        ORDER BY o.created_at DESC
      `,
					)
					.all();

				return Response.json(
					{
						success: true,
						orders: orders.results,
					},
					{
						headers: corsHeaders,
					},
				);
			} catch (err) {
				return Response.json(
					{
						success: false,
						error: err.message,
					},
					{
						status: 500,
						headers: corsHeaders,
					},
				);
			}
		}

		if (request.method === 'PUT' && url.pathname.startsWith('/api/admin/products/')) {
			try {
				const productId = url.pathname.split('/').pop();

				const { name, description, price, stock, image, category } = await request.json();

				const result = await env.d1_server
					.prepare(
						`
        UPDATE products
        SET
          name = ?,
          description = ?,
          price = ?,
          stock = ?,
          image = ?,
          category = ?
        WHERE id = ?
      `,
					)
					.bind(name, description, price, stock, image, category, productId)
					.run();

				if (result.meta.changes === 0) {
					return Response.json(
						{
							success: false,
							message: 'Product not found',
						},
						{
							status: 404,
							headers: corsHeaders,
						},
					);
				}

				return Response.json(
					{
						success: true,
						message: 'Product updated successfully',
					},
					{
						headers: corsHeaders,
					},
				);
			} catch (err) {
				return Response.json(
					{
						success: false,
						error: err.message,
					},
					{
						status: 500,
						headers: corsHeaders,
					},
				);
			}
		}

		if (request.method === 'GET' && url.pathname === '/api/user/orders') {
			try {
				const userId = url.searchParams.get('userId');

				if (!userId) {
					return Response.json(
						{
							success: false,
							message: 'User ID is required',
						},
						{
							status: 400,
							headers: corsHeaders,
						},
					);
				}

				// Get all orders
				const orders = await env.d1_server
					.prepare(
						`
        SELECT *
        FROM orders
        WHERE user_id = ?
        ORDER BY created_at DESC
      `,
					)
					.bind(userId)
					.all();

				// Attach items to each order
				for (const order of orders.results) {
					const items = await env.d1_server
						.prepare(
							`
          SELECT
              oi.id,
              oi.product_id,
              p.name,
              p.image,
              oi.quantity,
              oi.price
          FROM order_items oi

          JOIN products p
          ON oi.product_id = p.id

          WHERE oi.order_id = ?
        `,
						)
						.bind(order.id)
						.all();

					order.items = items.results;
				}

				return Response.json(
					{
						success: true,
						totalOrders: orders.results.length,
						orders: orders.results,
					},
					{
						headers: corsHeaders,
					},
				);
			} catch (err) {
				return Response.json(
					{
						success: false,
						error: err.message,
					},
					{
						status: 500,
						headers: corsHeaders,
					},
				);
			}
		}

		if (request.method === 'PUT' && url.pathname.startsWith('/api/admin/orders/') && url.pathname.endsWith('/status')) {
			try {
				const parts = url.pathname.split('/');
				const orderId = parts[4];

				const { order_status } = await request.json();

				const validStatuses = ['Received', 'In Transit', 'Delivered', 'Unable to Reach'];

				if (!validStatuses.includes(order_status)) {
					return Response.json(
						{
							success: false,
							message: 'Invalid order status',
						},
						{
							status: 400,
							headers: corsHeaders,
						},
					);
				}

				// -----------------------------------
				// 1. Get order + customer information
				// -----------------------------------

				const order = await env.d1_server
					.prepare(
						`
        SELECT
          id,
          customer_name,
          email,
          amount,
          order_status
        FROM orders
        WHERE id = ?
      `,
					)
					.bind(orderId)
					.first();

				if (!order) {
					return Response.json(
						{
							success: false,
							message: 'Order not found',
						},
						{
							status: 404,
							headers: corsHeaders,
						},
					);
				}

				// -----------------------------------
				// 2. Update order status
				// -----------------------------------

				const result = await env.d1_server
					.prepare(
						`
        UPDATE orders
        SET order_status = ?
        WHERE id = ?
      `,
					)
					.bind(order_status, orderId)
					.run();

				if (result.meta.changes === 0) {
					return Response.json(
						{
							success: false,
							message: 'Order status was not updated',
						},
						{
							status: 400,
							headers: corsHeaders,
						},
					);
				}

				// -----------------------------------
				// 3. Create email content
				// -----------------------------------

				let emailSubject = `Your Idexcy Order #${orderId} Update`;

				let emailHeading = `Your order is now ${order_status}`;

				let emailMessage = '';

				if (order_status === 'Received') {
					emailMessage = "We've received your order and will begin preparing it shortly.";
				}

				if (order_status === 'In Transit') {
					emailMessage = 'Good news! Your Idexcy order is on its way.';
				}

				if (order_status === 'Delivered') {
					emailMessage = 'Your Idexcy order has been delivered. We hope you enjoy every bite.';
				}

				if (order_status === 'Unable to Reach') {
					emailMessage = 'We were unable to reach you while attempting to deliver your Idexcy order. Our delivery team may try again soon.';
				}

				// -----------------------------------
				// 4. Send email using Resend
				// -----------------------------------

				let emailSent = false;

				try {
					const resendResponse = await fetch('https://api.resend.com/emails', {
						method: 'POST',
						headers: {
							Authorization: `Bearer ${env.RESEND_API_KEY}`,
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							from: 'Idexcy <orders@idexcy.com>',
							to: [order.email],
							subject: emailSubject,
							html: `
              <!DOCTYPE html>
              <html>
              <body style="
                margin:0;
                padding:0;
                background:#f7f3ef;
                font-family:Arial, sans-serif;
                color:#2b1b14;
              ">

                <div style="
                  max-width:600px;
                  margin:40px auto;
                  background:#ffffff;
                  padding:40px;
                ">

                  <h1 style="
                    margin:0 0 25px;
                    font-family:Georgia, serif;
                    font-size:28px;
                  ">
                    IDEXCY
                  </h1>

                  <p style="font-size:16px;">
                    Hi ${order.customer_name || 'there'},
                  </p>

                  <h2 style="
                    font-family:Georgia, serif;
                    font-size:24px;
                  ">
                    ${emailHeading}
                  </h2>

                  <p style="
                    font-size:16px;
                    line-height:1.6;
                  ">
                    ${emailMessage}
                  </p>

                  <div style="
                    margin:30px 0;
                    padding:20px;
                    background:#f7f3ef;
                  ">

                    <p style="margin:0 0 8px;">
                      <strong>Order #:</strong> ${order.id}
                    </p>

                    <p style="margin:0 0 8px;">
                      <strong>Status:</strong> ${order_status}
                    </p>

                    <p style="margin:0;">
                      <strong>Order Total:</strong> ₹${order.amount}
                    </p>

                  </div>

                  <p style="
                    font-size:14px;
                    line-height:1.6;
                    color:#666;
                  ">
                    Thank you for choosing Idexcy.
                  </p>

                  <p style="
                    font-size:14px;
                    color:#666;
                  ">
                    Crafted with purpose.
                  </p>

                </div>

              </body>
              </html>
            `,
						}),
					});

					const resendData = await resendResponse.json();

					console.log('Resend response:', resendData);

					if (resendResponse.ok) {
						emailSent = true;
					} else {
						console.error('Failed to send email:', resendData);
					}
				} catch (emailError) {
					console.error('Email sending error:', emailError);
				}

				// -----------------------------------
				// 5. Return response
				// -----------------------------------

				return Response.json(
					{
						success: true,
						message: 'Order status updated successfully',
						orderId,
						order_status,
						emailSent,
					},
					{
						headers: corsHeaders,
					},
				);
			} catch (err) {
				console.error('Order status error:', err);

				return Response.json(
					{
						success: false,
						error: err.message,
					},
					{
						status: 500,
						headers: corsHeaders,
					},
				);
			}
		}
		if (request.method === 'GET' && url.pathname.startsWith('/api/orders/')) {
			try {
				const orderId = url.pathname.split('/').pop();

				// Fetch order details
				const order = await env.d1_server
					.prepare(
						`
        SELECT *
        FROM orders
        WHERE id = ?
      `,
					)
					.bind(orderId)
					.first();

				if (!order) {
					return Response.json(
						{
							success: false,
							message: 'Order not found',
						},
						{
							status: 404,
							headers: corsHeaders,
						},
					);
				}

				// Fetch products in this order
				const items = await env.d1_server
					.prepare(
						`
        SELECT
          oi.id,
          oi.product_id,
          p.name,
          p.image,
          oi.quantity,
          oi.price,
          (oi.quantity * oi.price) AS subtotal
        FROM order_items oi
        JOIN products p
          ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `,
					)
					.bind(orderId)
					.all();

				order.items = items.results;

				return Response.json(
					{
						success: true,
						order,
					},
					{
						headers: corsHeaders,
					},
				);
			} catch (err) {
				return Response.json(
					{
						success: false,
						error: err.message,
					},
					{
						status: 500,
						headers: corsHeaders,
					},
				);
			}
		}

if (
    request.method === "GET" &&
    url.pathname === "/api/admin/blogs"
) {
    try {
        const blogs = await env.d1_server
            .prepare(`
                SELECT
                    id,
                    title,
                    slug,
                    short_description,
                    featured_image_url,
                    meta_title,
                    meta_description,
                    author_name,
                    status,
                    published_at,
                    created_at,
                    updated_at
                FROM blogs
                ORDER BY created_at DESC
            `)
            .all();

        return Response.json(
            {
                success: true,
                blogs: blogs.results
            },
            {
                headers: corsHeaders
            }
        );

    } catch (err) {

        console.error("Get admin blogs error:", err);

        return Response.json(
            {
                success: false,
                error: err.message
            },
            {
                status: 500,
                headers: corsHeaders
            }
        );
    }
}

if (
    request.method === "POST" &&
    url.pathname === "/api/admin/blogs"
) {
    try {

        const {
            title,
            slug,
            shortDescription,
            featuredImageUrl,
            metaTitle,
            metaDescription,
            authorName,
            status,
            publishedAt,
            sections,
            images,
            tags
        } = await request.json();

        // -----------------------------------
        // Validation
        // -----------------------------------

        if (!title || !slug || !shortDescription) {
            return Response.json(
                {
                    success: false,
                    message: "Title, slug and short description are required"
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );
        }

        // -----------------------------------
        // Check duplicate slug
        // -----------------------------------

        const existingBlog = await env.d1_server
            .prepare(`
                SELECT id
                FROM blogs
                WHERE slug = ?
            `)
            .bind(slug)
            .first();

        if (existingBlog) {
            return Response.json(
                {
                    success: false,
                    message: "A blog with this slug already exists"
                },
                {
                    status: 409,
                    headers: corsHeaders
                }
            );
        }

        // -----------------------------------
        // Create blog
        // -----------------------------------

        const result = await env.d1_server
            .prepare(`
                INSERT INTO blogs (
                    title,
                    slug,
                    short_description,
                    featured_image_url,
                    meta_title,
                    meta_description,
                    author_name,
                    status,
                    published_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .bind(
                title,
                slug,
                shortDescription,
                featuredImageUrl || "",
                metaTitle || "",
                metaDescription || "",
                authorName || "IDEXCY",
                status || "draft",
                publishedAt || null
            )
            .run();

        const blogId = result.meta.last_row_id;

        // -----------------------------------
        // Insert sections
        // -----------------------------------

        if (Array.isArray(sections)) {

            for (let i = 0; i < sections.length; i++) {

                const section = sections[i];

                if (!section.content) {
                    continue;
                }

                await env.d1_server
                    .prepare(`
                        INSERT INTO blog_sections (
                            blog_id,
                            section_order,
                            heading,
                            content
                        )
                        VALUES (?, ?, ?, ?)
                    `)
                    .bind(
                        blogId,
                        i,
                        section.heading || "",
                        section.content
                    )
                    .run();
            }
        }

        // -----------------------------------
        // Insert images
        // -----------------------------------

        if (Array.isArray(images)) {

            for (let i = 0; i < images.length; i++) {

                const image = images[i];

                if (!image.imageUrl) {
                    continue;
                }

                await env.d1_server
                    .prepare(`
                        INSERT INTO blog_images (
                            blog_id,
                            image_url,
                            alt_text,
                            image_order
                        )
                        VALUES (?, ?, ?, ?)
                    `)
                    .bind(
                        blogId,
                        image.imageUrl,
                        image.altText || "",
                        image.imageOrder ?? i
                    )
                    .run();
            }
        }

        // -----------------------------------
        // Insert tags
        // -----------------------------------

      // -----------------------------------
// Insert tags
// -----------------------------------

if (Array.isArray(tags)) {

    for (const tagName of tags) {

        if (!tagName || !tagName.trim()) {
            continue;
        }

        const cleanTag = tagName.trim();

        const tagSlug = cleanTag
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");

        if (!tagSlug) {
            continue;
        }

        // Create tag if it does not already exist.
        // If the slug already exists, INSERT OR IGNORE prevents
        // the UNIQUE constraint error.
        await env.d1_server
            .prepare(`
                INSERT OR IGNORE INTO blog_tags (
                    name,
                    slug
                )
                VALUES (?, ?)
            `)
            .bind(
                cleanTag,
                tagSlug
            )
            .run();

        // Always get the tag ID by its unique slug.
        const tag = await env.d1_server
            .prepare(`
                SELECT id
                FROM blog_tags
                WHERE slug = ?
                LIMIT 1
            `)
            .bind(tagSlug)
            .first();

        if (!tag) {
            throw new Error(`Unable to create or find blog tag: ${cleanTag}`);
        }

        // Connect tag to blog
        await env.d1_server
            .prepare(`
                INSERT OR IGNORE INTO blog_tag_relations (
                    blog_id,
                    tag_id
                )
                VALUES (?, ?)
            `)
            .bind(
                blogId,
                tag.id
            )
            .run();
    }
}

        return Response.json(
            {
                success: true,
                message: "Blog created successfully",
                blogId
            },
            {
                headers: corsHeaders
            }
        );

    } catch (err) {

        console.error("Create blog error:", err);

        return Response.json(
            {
                success: false,
                error: err.message
            },
            {
                status: 500,
                headers: corsHeaders
            }
        );
    }
}



if (
    request.method === "PUT" &&
    url.pathname.startsWith("/api/admin/blogs/")
) {
    try {

        const blogId = url.pathname.split("/").pop();

        const {
            title,
            slug,
            shortDescription,
            featuredImageUrl,
            metaTitle,
            metaDescription,
            authorName,
            status,
            publishedAt,
            sections,
            images,
            tags
        } = await request.json();

        // -----------------------------------
        // Validation
        // -----------------------------------

        if (!blogId) {
            return Response.json(
                {
                    success: false,
                    message: "Blog ID is required"
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );
        }

        if (!title || !slug || !shortDescription) {
            return Response.json(
                {
                    success: false,
                    message: "Title, slug and short description are required"
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );
        }

        // -----------------------------------
        // Check blog exists
        // -----------------------------------

        const existingBlog = await env.d1_server
            .prepare(`
                SELECT id
                FROM blogs
                WHERE id = ?
            `)
            .bind(blogId)
            .first();

        if (!existingBlog) {
            return Response.json(
                {
                    success: false,
                    message: "Blog not found"
                },
                {
                    status: 404,
                    headers: corsHeaders
                }
            );
        }

        // -----------------------------------
        // Check slug belongs to another blog
        // -----------------------------------

        const duplicateSlug = await env.d1_server
            .prepare(`
                SELECT id
                FROM blogs
                WHERE slug = ?
                AND id != ?
            `)
            .bind(slug, blogId)
            .first();

        if (duplicateSlug) {
            return Response.json(
                {
                    success: false,
                    message: "Another blog already uses this slug"
                },
                {
                    status: 409,
                    headers: corsHeaders
                }
            );
        }

        // -----------------------------------
        // Update main blog
        // -----------------------------------

        await env.d1_server
            .prepare(`
                UPDATE blogs
                SET
                    title = ?,
                    slug = ?,
                    short_description = ?,
                    featured_image_url = ?,
                    meta_title = ?,
                    meta_description = ?,
                    author_name = ?,
                    status = ?,
                    published_at = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `)
            .bind(
                title,
                slug,
                shortDescription,
                featuredImageUrl || "",
                metaTitle || "",
                metaDescription || "",
                authorName || "IDEXCY",
                status || "draft",
                publishedAt || null,
                blogId
            )
            .run();

        // -----------------------------------
        // Replace sections
        // -----------------------------------

        await env.d1_server
            .prepare(`
                DELETE FROM blog_sections
                WHERE blog_id = ?
            `)
            .bind(blogId)
            .run();

        if (Array.isArray(sections)) {

            for (let i = 0; i < sections.length; i++) {

                const section = sections[i];

                if (!section.content) {
                    continue;
                }

                await env.d1_server
                    .prepare(`
                        INSERT INTO blog_sections (
                            blog_id,
                            section_order,
                            heading,
                            content
                        )
                        VALUES (?, ?, ?, ?)
                    `)
                    .bind(
                        blogId,
                        i,
                        section.heading || "",
                        section.content
                    )
                    .run();
            }
        }

        // -----------------------------------
        // Replace images
        // -----------------------------------

        await env.d1_server
            .prepare(`
                DELETE FROM blog_images
                WHERE blog_id = ?
            `)
            .bind(blogId)
            .run();

        if (Array.isArray(images)) {

            for (let i = 0; i < images.length; i++) {

                const image = images[i];

                if (!image.imageUrl) {
                    continue;
                }

                await env.d1_server
                    .prepare(`
                        INSERT INTO blog_images (
                            blog_id,
                            image_url,
                            alt_text,
                            image_order
                        )
                        VALUES (?, ?, ?, ?)
                    `)
                    .bind(
                        blogId,
                        image.imageUrl,
                        image.altText || "",
                        image.imageOrder ?? i
                    )
                    .run();
            }
        }

        // -----------------------------------
        // Remove existing tag relations
        // -----------------------------------

        await env.d1_server
            .prepare(`
                DELETE FROM blog_tag_relations
                WHERE blog_id = ?
            `)
            .bind(blogId)
            .run();

        // -----------------------------------
        // Add tags
        // -----------------------------------

       // -----------------------------------
// Add tags
// -----------------------------------

if (Array.isArray(tags)) {

    for (const tagName of tags) {

        if (!tagName || !tagName.trim()) {
            continue;
        }

        const cleanTag = tagName.trim();

        const tagSlug = cleanTag
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");

        if (!tagSlug) {
            continue;
        }

        // Create the tag only if this slug does not already exist.
        await env.d1_server
            .prepare(`
                INSERT OR IGNORE INTO blog_tags (
                    name,
                    slug
                )
                VALUES (?, ?)
            `)
            .bind(
                cleanTag,
                tagSlug
            )
            .run();

        // Get the existing/new tag using the UNIQUE slug.
        const tag = await env.d1_server
            .prepare(`
                SELECT id
                FROM blog_tags
                WHERE slug = ?
                LIMIT 1
            `)
            .bind(tagSlug)
            .first();

        if (!tag) {
            throw new Error(`Unable to create or find blog tag: ${cleanTag}`);
        }

        // Connect tag to blog
        await env.d1_server
            .prepare(`
                INSERT OR IGNORE INTO blog_tag_relations (
                    blog_id,
                    tag_id
                )
                VALUES (?, ?)
            `)
            .bind(
                blogId,
                tag.id
            )
            .run();
    }
}

        return Response.json(
            {
                success: true,
                message: "Blog updated successfully",
                blogId
            },
            {
                headers: corsHeaders
            }
        );

    } catch (err) {

        console.error("Update blog error:", err);

        return Response.json(
            {
                success: false,
                error: err.message
            },
            {
                status: 500,
                headers: corsHeaders
            }
        );
    }
}




if (
    request.method === "DELETE" &&
    url.pathname.startsWith("/api/admin/blogs/")
) {
    try {

        const blogId = url.pathname.split("/").pop();

        if (!blogId) {
            return Response.json(
                {
                    success: false,
                    message: "Blog ID is required"
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );
        }

        // Check blog exists
        const blog = await env.d1_server
            .prepare(`
                SELECT id
                FROM blogs
                WHERE id = ?
            `)
            .bind(blogId)
            .first();

        if (!blog) {
            return Response.json(
                {
                    success: false,
                    message: "Blog not found"
                },
                {
                    status: 404,
                    headers: corsHeaders
                }
            );
        }

        // Delete blog
        await env.d1_server
            .prepare(`
                DELETE FROM blogs
                WHERE id = ?
            `)
            .bind(blogId)
            .run();

        return Response.json(
            {
                success: true,
                message: "Blog deleted successfully"
            },
            {
                headers: corsHeaders
            }
        );

    } catch (err) {

        console.error("Delete blog error:", err);

        return Response.json(
            {
                success: false,
                error: err.message
            },
            {
                status: 500,
                headers: corsHeaders
            }
        );
    }
}











		return new Response('Not Found', { status: 404, headers: corsHeaders });
	},
};
