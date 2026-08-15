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
      title: 'Aether — Hybrid climate control',
      meta: [
        {
          name: 'description',
          content:
            'Aether coordinates comfortable, efficient heating and cooling through Home Assistant.',
        },
      ],
    },
  },
});
