import { handlePublicBlogs } from "./routes/blogs.js";
import { handleAdminBlogs } from "./routes/adminBlogs.js";
import { handleAuth } from "./routes/auth.js";
import { handleOrders } from "./routes/orders.js";
import { handleProducts } from "./routes/products.js";
import { handleUsers } from "./routes/users.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://idexcy.com",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
    async fetch(request, env) {

        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: corsHeaders,
            });
        }

        const url = new URL(request.url);

        const handlers = [
            handlePublicBlogs,
            handleAdminBlogs,
            handleAuth,
            handleOrders,
            handleProducts,
            handleUsers,
        ];

        for (const handler of handlers) {
            const response = await handler(
                request,
                env,
                url,
                corsHeaders
            );

            if (response) return response;
        }

        // Only APIs that have NOT yet been extracted remain here.
    },
};