const json = (body, status = 200, corsHeaders = {}) =>
  Response.json(body, { status, headers: corsHeaders });

const PBKDF2_ITERATIONS = 100000;

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(derivedBits))}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash?.startsWith("pbkdf2$")) return false;

  const [, iterations, saltBase64, hashBase64] = storedHash.split("$");
  const salt = base64ToBytes(saltBase64);
  const expected = base64ToBytes(hashBase64);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: Number(iterations),
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  const derived = new Uint8Array(derivedBits);
  if (derived.length !== expected.length) return false;

  let difference = 0;
  for (let i = 0; i < derived.length; i++) {
    difference |= derived[i] ^ expected[i];
  }

  return difference === 0;
}

async function verifyEmail(request, env, corsHeaders) {
  const { email, code } = await request.json();

  if (!email || !code) {
    return json(
      { success: false, message: "Email and verification code are required." },
      400,
      corsHeaders
    );
  }

  const verification = await env.d1_server
    .prepare(`
      SELECT *
      FROM email_verifications
      WHERE email = ? AND code = ?
    `)
    .bind(email, code)
    .first();

  if (!verification) {
    return json(
      { success: false, message: "Invalid verification code." },
      400,
      corsHeaders
    );
  }

  if (new Date(verification.expires_at) < new Date()) {
    await env.d1_server
      .prepare(`DELETE FROM email_verifications WHERE id = ?`)
      .bind(verification.id)
      .run();

    return json(
      { success: false, message: "Verification code has expired." },
      400,
      corsHeaders
    );
  }

  await env.d1_server
    .prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`)
    .bind(verification.user_id)
    .run();

  await env.d1_server
    .prepare(`DELETE FROM email_verifications WHERE user_id = ?`)
    .bind(verification.user_id)
    .run();

  return json(
    { success: true, message: "Email verified successfully." },
    200,
    corsHeaders
  );
}

async function register(request, env, corsHeaders) {
  const { name, email, password } = await request.json();

  if (!name || !email || !password) {
    return json(
      { success: false, message: "Name, email and password are required." },
      400,
      corsHeaders
    );
  }

  const existingUser = await env.d1_server
    .prepare(`SELECT id FROM users WHERE email = ?`)
    .bind(email)
    .first();

  if (existingUser) {
    return json(
      { success: false, message: "Email is already registered." },
      409,
      corsHeaders
    );
  }

  const passwordHash = await hashPassword(password);

  const insertUser = await env.d1_server
    .prepare(`
      INSERT INTO users (name, email, password_hash)
      VALUES (?, ?, ?)
    `)
    .bind(name, email, passwordHash)
    .run();

  const userId = insertUser.meta.last_row_id;
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await env.d1_server
    .prepare(`DELETE FROM email_verifications WHERE email = ?`)
    .bind(email)
    .run();

  await env.d1_server
    .prepare(`
      INSERT INTO email_verifications (user_id, email, code, expires_at)
      VALUES (?, ?, ?, ?)
    `)
    .bind(userId, email, code, expires)
    .run();

  const payload = {
    from: "Idexcy <orders@idexcy.com>",
    to: [email],
    subject: "Verify your Email",
    html: `<div style="font-family:Arial,sans-serif"><h2>Welcome to Idexcy</h2><p>Thank you for creating your account.</p><p>Your verification code is:</p><h1 style="letter-spacing:5px;">${code}</h1><p>This code will expire in <strong>10 minutes</strong>.</p><p>If you didn't create this account, you can safely ignore this email.</p></div>`,
  };

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resendResponse.ok) {
    return json(
      { success: false, message: "Failed to send verification email." },
      500,
      corsHeaders
    );
  }

  return json(
    {
      success: true,
      message: "Registration successful. Please verify your email.",
      requiresVerification: true,
    },
    200,
    corsHeaders
  );
}

async function login(request, env, corsHeaders) {
  const { email, password } = await request.json();

  if (!email || !password) {
    return json(
      { success: false, message: "Email and password are required" },
      400,
      corsHeaders
    );
  }

  const user = await env.d1_server
    .prepare(`
      SELECT id, name, email, is_admin, password_hash
      FROM users
      WHERE email = ?
    `)
    .bind(email)
    .first();

  if (!user) {
    return json(
      { success: false, message: "Invalid email or password" },
      401,
      corsHeaders
    );
  }

  const passwordValid = await verifyPassword(password, user.password_hash);

  if (!passwordValid) {
    return json(
      { success: false, message: "Invalid email or password" },
      401,
      corsHeaders
    );
  }

  return json(
    {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        is_admin: user.is_admin,
      },
    },
    200,
    corsHeaders
  );
}

export async function handleAuth(request, env, url, corsHeaders) {
  if (request.method !== "POST") return null;

  try {
    if (url.pathname === "/api/register") {
      return await register(request, env, corsHeaders);
    }

    if (url.pathname === "/api/login") {
      return await login(request, env, corsHeaders);
    }

    if (url.pathname === "/api/verify-email") {
      return await verifyEmail(request, env, corsHeaders);
    }

    return null;
  } catch (err) {
    console.error("Auth error:", err);
    return json(
      { success: false, message: err.message || "Internal server error." },
      500,
      corsHeaders
    );
  }
}

export { hashPassword, verifyPassword, PBKDF2_ITERATIONS };
