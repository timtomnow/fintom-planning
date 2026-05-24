'use strict';

// Bump this string whenever app files change to invalidate the old cache.
const CACHE_VERSION = 'fintom-v3';

const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './favicon.png',
  './manifest.json',
  './js/utils.js',
  './js/data.js',
  './js/engine.js',
  './js/ui.js',
  './js/pages/dashboard.js',
  './js/pages/baselines.js',
  './js/pages/events.js',
  './js/pages/inputs.js',
  './js/pages/analysis.js',
  './js/pages/results.js',
  './js/pages/settings.js',
  './js/pages/v1/shell.js',
  './js/pages/v1/summary-components.js',
  './js/pages/v1/workflows.js',
  './js/pages/v1/workflow-quickstart-family.js',
  './js/pages/v1/get-started.js',
  './js/pages/v1/history.js',
  './js/vendor/chart.umd.min.js',
  './js/vendor/marked.min.js',
];

// Icons are optional — cache them if present, skip gracefully if not yet added.
const OPTIONAL_ASSETS = [
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(CORE_ASSETS);
    await Promise.allSettled(
      OPTIONAL_ASSETS.map(url => cache.add(url).catch(() => {}))
    );
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
      throw new Error('Network unavailable and resource not cached');
    }
  })());
});
