// URLチェック結果のキャッシュ
const urlCache = new Map();

// 処理中のURLセット（重複リクエスト防止）
const pendingChecks = new Map();

// CSSクラス名
const VISITED_CLASS = 'extension-recalled';

// カスタムCSSをページに注入
function injectCustomCss(css) {
  // 既存のカスタムスタイルを削除
  const existingStyle = document.getElementById('perma-recall-custom-style');
  if (existingStyle) {
    existingStyle.remove();
  }

  // カスタムCSSがある場合のみ注入
  if (css && css.trim()) {
    const style = document.createElement('style');
    style.id = 'perma-recall-custom-style';
    style.textContent = css;
    document.head.appendChild(style);
  }
}

// 保存されたカスタムCSSを読み込み
async function loadAndApplyCustomCss() {
  try {
    // 拡張機能コンテキストが有効かチェック
    if (!chrome.runtime?.id) {
      console.warn('Extension context invalidated, skipping CSS load');
      return;
    }

    const result = await chrome.storage.local.get(['customCss']);
    if (result.customCss) {
      injectCustomCss(result.customCss);
    }
  } catch (error) {
    console.warn('Failed to load custom CSS:', error.message);
  }
}

// URLを正規化（オプション：将来的な拡張用）
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    // 基本的な正規化: プロトコル + ホスト + パス
    // 必要に応じてクエリパラメータの除去などを追加可能
    return urlObj.href;
  } catch (e) {
    return url;
  }
}

// 単一URLのチェック
async function checkUrlVisited(url) {
  const normalizedUrl = normalizeUrl(url);

  // キャッシュに存在する場合
  if (urlCache.has(normalizedUrl)) {
    return urlCache.get(normalizedUrl);
  }

  // 既に処理中の場合は、その結果を待つ
  if (pendingChecks.has(normalizedUrl)) {
    return pendingChecks.get(normalizedUrl);
  }

  // 新規チェックを開始
  const checkPromise = new Promise((resolve) => {
    try {
      // 拡張機能コンテキストが有効かチェック
      if (!chrome.runtime?.id) {
        console.warn('Extension context invalidated, skipping URL check');
        pendingChecks.delete(normalizedUrl);
        resolve(false);
        return;
      }

      chrome.runtime.sendMessage(
        { action: 'checkUrl', url: normalizedUrl },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn('Error checking URL:', chrome.runtime.lastError.message);
            pendingChecks.delete(normalizedUrl);
            resolve(false);
            return;
          }

          const isVisited = response?.isVisited || false;
          // キャッシュに保存
          urlCache.set(normalizedUrl, isVisited);
          // 処理中リストから削除
          pendingChecks.delete(normalizedUrl);
          resolve(isVisited);
        }
      );
    } catch (error) {
      console.warn('Exception in checkUrlVisited:', error.message);
      pendingChecks.delete(normalizedUrl);
      resolve(false);
    }
  });

  pendingChecks.set(normalizedUrl, checkPromise);
  return checkPromise;
}

// 複数URLの一括チェック
async function checkUrlsBatch(urls) {
  const uniqueUrls = [...new Set(urls.map(normalizeUrl))];
  const uncachedUrls = uniqueUrls.filter(url => !urlCache.has(url));

  if (uncachedUrls.length === 0) {
    // 全てキャッシュ済み
    return uniqueUrls.map(url => ({
      url,
      isVisited: urlCache.get(url)
    }));
  }

  // 未キャッシュのURLをバックグラウンドに問い合わせ
  return new Promise((resolve) => {
    try {
      // 拡張機能コンテキストが有効かチェック
      if (!chrome.runtime?.id) {
        console.warn('Extension context invalidated, skipping URL check');
        resolve(uniqueUrls.map(url => ({ url, isVisited: false })));
        return;
      }

      chrome.runtime.sendMessage(
        { action: 'checkUrls', urls: uncachedUrls },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn('Error checking URLs:', chrome.runtime.lastError.message);
            resolve(uniqueUrls.map(url => ({ url, isVisited: false })));
            return;
          }

          // キャッシュに保存
          if (response?.results) {
            response.results.forEach(({ url, isVisited }) => {
              urlCache.set(url, isVisited);
            });
          }

          // 全てのURLの結果を返す（キャッシュ済みも含む）
          const allResults = uniqueUrls.map(url => ({
            url,
            isVisited: urlCache.get(url) || false
          }));

          resolve(allResults);
        }
      );
    } catch (error) {
      console.warn('Exception in checkUrlsBatch:', error.message);
      resolve(uniqueUrls.map(url => ({ url, isVisited: false })));
    }
  });
}

// リンクにクラスを付与
function markLink(link, isVisited) {
  if (isVisited && !link.classList.contains(VISITED_CLASS)) {
    link.classList.add(VISITED_CLASS);
  }
}

// ページ内の全リンクを処理
async function processLinks() {
  const links = document.querySelectorAll('a[href]');

  if (links.length === 0) return;

  // URLとリンク要素のマップを作成
  const urlToLinks = new Map();
  const urls = [];

  links.forEach(link => {
    const href = link.href;
    if (!href || href.startsWith('javascript:') || href.startsWith('#')) {
      return;
    }

    const normalizedUrl = normalizeUrl(href);
    if (!urlToLinks.has(normalizedUrl)) {
      urlToLinks.set(normalizedUrl, []);
      urls.push(normalizedUrl);
    }
    urlToLinks.get(normalizedUrl).push(link);
  });

  // バッチ処理で効率化
  const batchSize = 50;
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const results = await checkUrlsBatch(batch);

    results.forEach(({ url, isVisited }) => {
      const linkElements = urlToLinks.get(url) || [];
      linkElements.forEach(link => markLink(link, isVisited));
    });
  }
}

// Mutation ObserverでDOM変更を監視
const observer = new MutationObserver((mutations) => {
  let hasNewLinks = false;

  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === 'A' || node.querySelector('a')) {
            hasNewLinks = true;
            break;
          }
        }
      }
    }
  }

  if (hasNewLinks) {
    // デバウンス処理
    clearTimeout(observer.timeoutId);
    observer.timeoutId = setTimeout(() => {
      processLinks();
    }, 300);
  }
});

// 初期化
function initialize() {
  // カスタムCSSを読み込んで適用
  loadAndApplyCustomCss();

  // 初回処理
  processLinks();

  // DOM監視を開始
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  console.log('Perma-Recall Link initialized');
}

// ポップアップからのCSSアップデートメッセージをリッスン
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateCss') {
    injectCustomCss(request.css);
    sendResponse({ success: true });
  }
});

// ページ読み込み完了後に実行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
