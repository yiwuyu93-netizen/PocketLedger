"use strict";

/*
 * 修改 CACHE_VERSION 可以触发缓存升级。
 */
const CACHE_VERSION = "pocket-ledger-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon.svg"
];


/* =========================================
   安装：缓存应用文件
========================================= */

self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);

      /*
       * 逐个缓存资源。
       * 如果关键文件无法缓存，安装会失败，
       * 避免产生不完整的离线应用。
       */
      await cache.addAll(APP_SHELL);

      /*
       * 新版本安装成功后，等待激活。
       */
      await self.skipWaiting();
    })()
  );
});


/* =========================================
   激活：清理旧缓存
========================================= */

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter(key => {
            return (
              key.startsWith("pocket-ledger-") &&
              key !== CACHE_VERSION
            );
          })
          .map(key => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});


/* =========================================
   请求：优先读取缓存
========================================= */

self.addEventListener("fetch", event => {
  const request = event.request;

  /*
   * 只处理 GET 请求。
   * 不拦截表单提交或其他非读取请求。
   */
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  /*
   * 只缓存当前站点的资源。
   */
  if (url.origin !== self.location.origin) {
    return;
  }

  /*
   * 仅处理 HTTP(S) 请求。
   */
  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    return;
  }

  /*
   * 导航请求：优先读取缓存中的首页。
   *
   * 即使断网，也尽可能返回可运行的应用入口。
   */
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);

        const cachedPage = await cache.match("./index.html");

        if (cachedPage) {
          return cachedPage;
        }

        try {
          return await fetch(request);
        } catch {
          return new Response(
            "应用尚未完成离线缓存，请联网后重新打开。",
            {
              status: 503,
              headers: {
                "Content-Type": "text/plain; charset=utf-8"
              }
            }
          );
        }
      })()
    );

    return;
  }

  /*
   * 静态资源：缓存优先，未命中时联网获取。
   */
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);

      const cachedResponse = await cache.match(request);

      if (cachedResponse) {
        return cachedResponse;
      }

      try {
        const response = await fetch(request);

        /*
         * 仅缓存成功的同源基本响应。
         */
        if (
          response.ok &&
          response.type === "basic"
        ) {
          await cache.put(
            request,
            response.clone()
          );
        }

        return response;

      } catch {
        return new Response(
          "当前资源尚未缓存，请联网后重试。",
          {
            status: 503,
            headers: {
              "Content-Type": "text/plain; charset=utf-8"
            }
          }
        );
      }
    })()
  );
});
