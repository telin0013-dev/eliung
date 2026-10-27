'use strict';

// engine/tweaks.js は CommonJS なので、ブラウザでのプレビュー用に module を用意しておく。
// （Electron では preload の window.api を使うため、ここで読み込んだデータは mock-api.js だけが使う）
window.module = { exports: {} };
