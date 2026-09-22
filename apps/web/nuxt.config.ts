import tailwindcss from '@tailwindcss/vite';

export default defineNuxtConfig({
  compatibilityDate: '2026-08-13',
  ssr: false,
  css: ['~/assets/css/main.css'],
  devtools: {
    enabled: true,
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3001',
        },
      },
      strictPort: true,
    },
  },
  typescript: {
    strict: true,
  },
  app: {
    head: {
      htmlAttrs: {
        lang: 'en',
      },
      title: 'Aether — Whole-house climate scheduling',
      meta: [
        {
          name: 'description',
          content: 'Aether schedules heating and cooling across Home Assistant climate systems.',
        },
      ],
    },
  },
});
