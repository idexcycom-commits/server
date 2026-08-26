const json = (body, status = 200, corsHeaders = {}) =>
  Response.json(body, { status, headers: corsHeaders });

const getBlogId = (url) => {
  const match = url.pathname.match(/^\/api\/admin\/blogs\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
};

async function addTags(env, blogId, tags) {
  if (!Array.isArray(tags)) return;

  for (const tagName of tags) {
    if (!tagName || !tagName.trim()) continue;

    const cleanTag = tagName.trim();
    const tagSlug = cleanTag
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (!tagSlug) continue;

    await env.d1_server
      .prepare(`
        INSERT OR IGNORE INTO blog_tags (name, slug)
        VALUES (?, ?)
      `)
      .bind(cleanTag, tagSlug)
      .run();

    const tag = await env.d1_server
      .prepare(`SELECT id FROM blog_tags WHERE slug = ? LIMIT 1`)
      .bind(tagSlug)
      .first();

    if (!tag) throw new Error(`Unable to create or find blog tag: ${cleanTag}`);

    await env.d1_server
      .prepare(`
        INSERT OR IGNORE INTO blog_tag_relations (blog_id, tag_id)
        VALUES (?, ?)
      `)
      .bind(blogId, tag.id)
      .run();
  }
}

async function replaceSections(env, blogId, sections) {
  await env.d1_server.prepare(`DELETE FROM blog_sections WHERE blog_id = ?`).bind(blogId).run();

  if (!Array.isArray(sections)) return;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section?.content) continue;

    await env.d1_server
      .prepare(`
        INSERT INTO blog_sections (blog_id, section_order, heading, content)
        VALUES (?, ?, ?, ?)
      `)
      .bind(blogId, i, section.heading || "", section.content)
      .run();
  }
}

async function replaceImages(env, blogId, images) {
  await env.d1_server.prepare(`DELETE FROM blog_images WHERE blog_id = ?`).bind(blogId).run();

  if (!Array.isArray(images)) return;

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    if (!image?.imageUrl) continue;

    await env.d1_server
      .prepare(`
        INSERT INTO blog_images (blog_id, image_url, alt_text, image_order)
        VALUES (?, ?, ?, ?)
      `)
      .bind(blogId, image.imageUrl, image.altText || "", image.imageOrder ?? i)
      .run();
  }
}

async function replaceTags(env, blogId, tags) {
  await env.d1_server
    .prepare(`DELETE FROM blog_tag_relations WHERE blog_id = ?`)
    .bind(blogId)
    .run();

  await addTags(env, blogId, tags);
}

export async function handleAdminBlogs(request, env, url, corsHeaders) {
  if (!url.pathname.startsWith("/api/admin/blogs")) return null;

  try {
    // GET /api/admin/blogs
    if (request.method === "GET" && url.pathname === "/api/admin/blogs") {
      const blogs = await env.d1_server
        .prepare(`
          SELECT id, title, slug, short_description, featured_image_url,
                 meta_title, meta_description, author_name, status,
                 published_at, created_at, updated_at
          FROM blogs
          ORDER BY created_at DESC
        `)
        .all();

      return json({ success: true, blogs: blogs.results }, 200, corsHeaders);
    }

    const blogId = getBlogId(url);

    // GET /api/admin/blogs/:id
    if (request.method === "GET" && blogId) {
      const blog = await env.d1_server
        .prepare(`SELECT * FROM blogs WHERE id = ?`)
        .bind(blogId)
        .first();

      if (!blog) return json({ success: false, message: "Blog not found" }, 404, corsHeaders);

      const [sections, images, tags] = await Promise.all([
        env.d1_server.prepare(`
          SELECT id, section_order, heading, content
          FROM blog_sections WHERE blog_id = ? ORDER BY section_order ASC
        `).bind(blogId).all(),
        env.d1_server.prepare(`
          SELECT id, image_url, alt_text, image_order
          FROM blog_images WHERE blog_id = ? ORDER BY image_order ASC
        `).bind(blogId).all(),
        env.d1_server.prepare(`
          SELECT bt.id, bt.name, bt.slug
          FROM blog_tags bt
          JOIN blog_tag_relations btr ON btr.tag_id = bt.id
          WHERE btr.blog_id = ? ORDER BY bt.name ASC
        `).bind(blogId).all(),
      ]);

      return json({
        success: true,
        blog: {
          ...blog,
          sections: sections.results,
          images: images.results,
          tags: tags.results,
        },
      }, 200, corsHeaders);
    }

    // POST /api/admin/blogs
    if (request.method === "POST" && url.pathname === "/api/admin/blogs") {
      const {
        title, slug, shortDescription, featuredImageUrl, metaTitle,
        metaDescription, authorName, status, publishedAt, sections, images, tags,
      } = await request.json();

      if (!title || !slug || !shortDescription) {
        return json({ success: false, message: "Title, slug and short description are required" }, 400, corsHeaders);
      }

      const existing = await env.d1_server.prepare(`SELECT id FROM blogs WHERE slug = ?`).bind(slug).first();
      if (existing) return json({ success: false, message: "A blog with this slug already exists" }, 409, corsHeaders);

      const result = await env.d1_server.prepare(`
        INSERT INTO blogs (
          title, slug, short_description, featured_image_url, meta_title,
          meta_description, author_name, status, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        title, slug, shortDescription, featuredImageUrl || "", metaTitle || "",
        metaDescription || "", authorName || "IDEXCY", status || "draft", publishedAt || null,
      ).run();

      const newBlogId = result.meta.last_row_id;
      await replaceSections(env, newBlogId, sections);
      await replaceImages(env, newBlogId, images);
      await replaceTags(env, newBlogId, tags);

      return json({ success: true, message: "Blog created successfully", blogId: newBlogId }, 200, corsHeaders);
    }

    // PUT /api/admin/blogs/:id
    if (request.method === "PUT" && blogId) {
      const {
        title, slug, shortDescription, featuredImageUrl, metaTitle,
        metaDescription, authorName, status, publishedAt, sections, images, tags,
      } = await request.json();

      if (!title || !slug || !shortDescription) {
        return json({ success: false, message: "Title, slug and short description are required" }, 400, corsHeaders);
      }

      const existing = await env.d1_server.prepare(`SELECT id FROM blogs WHERE id = ?`).bind(blogId).first();
      if (!existing) return json({ success: false, message: "Blog not found" }, 404, corsHeaders);

      const duplicate = await env.d1_server
        .prepare(`SELECT id FROM blogs WHERE slug = ? AND id != ?`)
        .bind(slug, blogId)
        .first();
      if (duplicate) return json({ success: false, message: "Another blog already uses this slug" }, 409, corsHeaders);

      await env.d1_server.prepare(`
        UPDATE blogs SET
          title = ?, slug = ?, short_description = ?, featured_image_url = ?,
          meta_title = ?, meta_description = ?, author_name = ?, status = ?,
          published_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        title, slug, shortDescription, featuredImageUrl || "", metaTitle || "",
        metaDescription || "", authorName || "IDEXCY", status || "draft", publishedAt || null, blogId,
      ).run();

      await replaceSections(env, blogId, sections);
      await replaceImages(env, blogId, images);
      await replaceTags(env, blogId, tags);

      return json({ success: true, message: "Blog updated successfully", blogId }, 200, corsHeaders);
    }

    // DELETE /api/admin/blogs/:id
    if (request.method === "DELETE" && blogId) {
      const existing = await env.d1_server.prepare(`SELECT id FROM blogs WHERE id = ?`).bind(blogId).first();
      if (!existing) return json({ success: false, message: "Blog not found" }, 404, corsHeaders);

      // Remove dependent records first so this works regardless of FK cascade settings.
      await env.d1_server.batch([
        env.d1_server.prepare(`DELETE FROM blog_tag_relations WHERE blog_id = ?`).bind(blogId),
        env.d1_server.prepare(`DELETE FROM blog_sections WHERE blog_id = ?`).bind(blogId),
        env.d1_server.prepare(`DELETE FROM blog_images WHERE blog_id = ?`).bind(blogId),
        env.d1_server.prepare(`DELETE FROM blogs WHERE id = ?`).bind(blogId),
      ]);

      return json({ success: true, message: "Blog deleted successfully", blogId }, 200, corsHeaders);
    }

    return json({ success: false, message: "Method not allowed" }, 405, corsHeaders);
  } catch (err) {
    console.error("Admin blogs error:", err);
    return json({ success: false, error: err.message }, 500, corsHeaders);
  }
}
