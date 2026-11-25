/* Service worker: guarda a casca do app para abrir sem internet. Mudou arquivo? Aumente VERSAO.
   v13 (25/11): app Android único (item Vigia, token ao vigia, salvar arquivo pela ponte, voz do teclado). v12 (25/11): ajustes etapa 2 (menu, família com telefone, botões, botões criados, mensagens). v11 (24/11): endereço do servidor da família e CSP exata. v10 (22/11): etapa C, família conectada (config.js, regras.js, sync.js). v9 (22/11): etapa B, modelo sobre/anotadoPor e store arquivos. v8 (22/11): voz.js. v7: ícone novo Atlas Saúde. T-0035-5: v6 — entram os ícones SVG. Os PNG ficam FORA da lista de propósito: se um PNG faltasse,
   cache.addAll falharia e o app nem instalaria o modo sem internet. O teste offline.test.js confere esta lista contra o index.html. */
var VERSAO = 'diario-saude-v13';
var ARQUIVOS = ['./', 'index.html', 'styles.css', 'app.js', 'db.js', 'registros.js', 'estatisticas.js', 'estatisticas-tela.js', 'relatorio.js', 'relatorio-tela.js', 'voz.js', 'familia.js', 'ajustes-tela.js', 'config.js', 'regras.js', 'sync.js', 'manifest.json', 'icon.svg', 'icon-maskable.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSAO).then(function (c) { return c.addAll(ARQUIVOS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSAO; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
    return hit || fetch(e.request).catch(function () {
      return e.request.mode === 'navigate' ? caches.match('index.html') : Response.error();
    });
  }));
});
