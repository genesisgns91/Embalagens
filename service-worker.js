// ── SERVICE WORKER · Magius · Controle de Embalagens ─────────────────
// Estratégia:
//  - App Shell (HTML/CSS/JS/ícones próprios do domínio): cache-first com
//    atualização em segundo plano (stale-while-revalidate).
//  - Firebase (Auth/Firestore) e qualquer chamada de API: NUNCA cacheado,
//    sempre direto na rede — dados de estoque/saldo precisam estar sempre
//    atualizados e não podem ficar "presos" em cache.
//  - Navegação (abrir o app): network-first com fallback para o cache,
//    para permitir abrir o app mesmo offline (mostrando a última versão).
 
const CACHE_VERSION = 'v1';
const CACHE_NAME = `magius-embalagens-${CACHE_VERSION}`;
 
// Domínios que NUNCA devem ser interceptados/cacheados pelo Service Worker.
// Deixamos essas requisições seguirem 100% para a rede (comportamento padrão do browser).
const DOMINIOS_IGNORADOS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'www.googleapis.com'
];
 
// Arquivos do "esqueleto" do app, cacheados na instalação.
// Ajuste os caminhos caso o app não esteja na raiz do domínio.
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-192.png',
  'icon-maskable-512.png'
];
 
// ── INSTALL ────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.error('[SW] Falha ao cachear o app shell:', err))
  );
  self.skipWaiting(); // ativa o novo SW imediatamente, sem esperar todas as abas fecharem
});
 
// ── ACTIVATE ───────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(
        nomes
          .filter((nome) => nome.startsWith('magius-embalagens-') && nome !== CACHE_NAME)
          .map((nome) => caches.delete(nome))
      )
    )
  );
  self.clients.claim(); // assume o controle das abas já abertas
});
 
// ── FETCH ──────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
 
  // Só interceptamos requisições GET; POST/PUT/DELETE (Firestore, etc.) passam direto.
  if (request.method !== 'GET') return;
 
  const url = new URL(request.url);
 
  // Nunca interceptar Firebase/Firestore/Auth — sempre rede, sempre dado fresco.
  if (DOMINIOS_IGNORADOS.some((dominio) => url.hostname.includes(dominio))) {
    return;
  }
 
  // Navegação (o usuário abrindo/recarregando o app): network-first com fallback em cache.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((resposta) => {
          const clone = resposta.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone));
          return resposta;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }
 
  // Demais arquivos estáticos (CSS, JS, imagens, fontes, libs de CDN como xlsx.js):
  // stale-while-revalidate — responde rápido com o cache e atualiza em segundo plano.
  event.respondWith(
    caches.match(request).then((respostaCache) => {
      const fetchPromise = fetch(request)
        .then((respostaRede) => {
          if (respostaRede && respostaRede.status === 200) {
            const clone = respostaRede.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return respostaRede;
        })
        .catch(() => respostaCache); // offline e sem cache: falha silenciosa
 
      return respostaCache || fetchPromise;
    })
  );
});
