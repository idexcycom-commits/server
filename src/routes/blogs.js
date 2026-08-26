const json = (body, status = 200, corsHeaders = {}) =>
  Response.json(body, { status, headers: corsHeaders });

export async function handlePublicBlogs(request, env, url, corsHeaders) {
  if (request.method !== "GET") return null;

  // Public blog listing: published posts only.
  if (url.pathname === "/api/blogs") {
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
            published_at,
            created_at,
            updated_at
          FROM blogs
          WHERE status = 'published'
          ORDER BY published_at DESC, created_at DESC
        `)
        .all();

      return json({ success: true, blogs: blogs.results }, 200, corsHeaders);
    } catch (err) {
      console.error("Get public blogs error:", err);
      return json({ success: false, error: err.message }, 500, corsHeaders);
    }
  }

  // Public single blog: published posts only, addressed by slug.
  if (url.pathname.startsWith("/api/blogs/") && url.pathname !== "/api/blogs/") {
    try {
      const slug = decodeURIComponent(url.pathname.slice("/api/blogs/".length));

      if (!slug) {
        return json({ success: false, message: "Blog slug is required" }, 400, corsHeaders);
      }

      const blog = await env.d1_server
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
          WHERE slug = ?
            AND status = 'published'
          LIMIT 1
        `)
        .bind(slug)
        .first();

      if (!blog) {
        return json({ success: false, message: "Blog not found" }, 404, corsHeaders);
      }

      const sections = await env.d1_server
        .prepare(`
          SELECT id, heading, content, section_order
          FROM blog_sections
          WHERE blog_id = ?
          ORDER BY section_order ASC
        `)
        .bind(blog.id)
        .all();

      const images = await env.d1_server
        .prepare(`
          SELECT id, image_url, alt_text, image_order
          FROM blog_images
          WHERE blog_id = ?
          ORDER BY image_order ASC
        `)
        .bind(blog.id)
        .all();

      const tags = await env.d1_server
        .prepare(`
          SELECT bt.id, bt.name, bt.slug
          FROM blog_tags bt
          JOIN blog_tag_relations btr ON bt.id = btr.tag_id
          WHERE btr.blog_id = ?
          ORDER BY bt.name ASC
        `)
        .bind(blog.id)
        .all();

      return json({
        success: true,
        blog: {
          ...blog,
          sections: sections.results,
          images: images.results,
          tags: tags.results,
        },
      }, 200, corsHeaders);
    } catch (err) {
      console.error("Get public blog error:", err);
      return json({ success: false, error: err.message }, 500, corsHeaders);
    }
  }

  return null;
}
