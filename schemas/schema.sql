CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,

    email_verified INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    category TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,

    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    razorpay_signature TEXT,

    amount REAL NOT NULL,
    currency TEXT DEFAULT 'INR',

    payment_status TEXT DEFAULT 'Paid',
    order_status TEXT DEFAULT 'Pending',

    customer_name TEXT,
    email TEXT,
    phone TEXT,

    address TEXT,
    city TEXT,
    state TEXT,
    pincode TEXT,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT,
    quantity INTEGER,
    price REAL,

    FOREIGN KEY(order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS email_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,

    short_description TEXT NOT NULL,

    featured_image_url TEXT,

    meta_title TEXT,
    meta_description TEXT,

    author_name TEXT DEFAULT 'IDEXCY',

    status TEXT NOT NULL DEFAULT 'draft',

    published_at DATETIME,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blog_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    blog_id INTEGER NOT NULL,

    section_order INTEGER NOT NULL DEFAULT 0,

    heading TEXT,
    content TEXT NOT NULL,

    FOREIGN KEY (blog_id)
        REFERENCES blogs(id)
        ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS blog_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    blog_id INTEGER NOT NULL,

    image_url TEXT NOT NULL,

    alt_text TEXT,

    image_order INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (blog_id)
        REFERENCES blogs(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blog_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    name TEXT NOT NULL UNIQUE,

    slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS blog_tag_relations (
    blog_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,

    PRIMARY KEY (blog_id, tag_id),

    FOREIGN KEY (blog_id)
        REFERENCES blogs(id)
        ON DELETE CASCADE,

    FOREIGN KEY (tag_id)
        REFERENCES blog_tags(id)
        ON DELETE CASCADE
);