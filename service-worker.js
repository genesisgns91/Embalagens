// ── SERVICE WORKER · Magius · Controle de Embalagens ─────────────────
// Estratégia:
//  - App Shell (HTML/CSS/JS/ícones próprios do domínio): cache-first com
//    atualização em segundo plano (stale-while-revalidate).
//  - Firebase (Auth/Firestore) e qualquer chamada de API: NUNCA cacheado,
//    sempre direto na rede — dados de estoque/saldo precisam estar sempre
//    atualizados e não podem ficar "presos" em cache.
//  - Navegação (abrir o app): network-first com fallback para o cache,
//    para permitir abrir o app mesmo offline (mostrando a última versão).
//
// ── FIREBASE CLOUD MESSAGING ──────────────────────────────────────────
// Este MESMO service worker também recebe as notificações push do FCM.
// Importante: só pode existir UM service worker controlando o escopo "/".
// Por isso, em vez de registrar um "firebase-messaging-sw.js" separado
// (o que entraria em conflito de escopo com este arquivo), importamos os
// scripts "compat" do Firebase Messaging aqui dentro. O app (index.html)
// deve passar EXPLICITAMENTE o registration deste service worker ao
// chamar getToken() — ver instruções enviadas junto com este arquivo.

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAmX8gVADeGgS9SFBdN18Y1MmVwzIlC2tE",
  authDomain: "embalagens-19e30.firebaseapp.com",
  projectId: "embalagens-19e30",
  storageBucket: "embalagens-19e30.firebasestorage.app",
  messagingSenderId: "202746410182",
  appId: "1:202746410182:web:5275f53f8fe0db3a2b93c7",
});

const messaging = firebase.messaging();

// Disparado quando chega um push do FCM e o app está em segundo plano ou fechado
// (com o navegador/PWA ainda ativo o suficiente para acordar o service worker).
messaging.onBackgroundMessage((payload) => {
  const dados = payload.notification || {};
  const titulo = dados.title || 'Magius · Controle de Embalagens';
  const opcoes = {
    body: dados.body || '',
    icon: dados.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.data?.tag || undefined,
    renotify: true,
    data: payload.data || {}
  };
  self.registration.showNotification(titulo, opcoes);
});

// Clique na notificação: foca uma aba já aberta do app ou abre uma nova
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
 
const CACHE_VERSION = 'v2'; // bump para forçar atualização do SW nos dispositivos (novo: suporte a FCM)
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
