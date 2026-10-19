import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        sales: "contact-sales.html",
        admin: "admin.html",
        adminLogin: "admin-login/index.html",
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:7860",
      "/lab": { target: "http://127.0.0.1:7860", ws: true },
    },
  },
  preview: {
    proxy: {
      "/api": process.env.ADMIN_API_TARGET || "http://127.0.0.1:7860",
      "/lab": { target: process.env.ADMIN_API_TARGET || "http://127.0.0.1:7860", ws: true },
    },
    allowedHosts: [".up.railway.app"],
  },
});
