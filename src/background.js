// IndexedDB設定
const DB_NAME = 'PermaRecallDB';
const DB_VERSION = 1;
const STORE_NAME = 'VisitedLinks';

let db = null;
let dbInitPromise = null; // DB初期化のPromiseを保持

// インポート進行状況を追跡
let importProgress = {
  inProgress: false,
  total: 0,
  imported: 0
};

// IndexedDBの初期化
function initDB() {
  // 既に初期化中または完了している場合は、そのPromiseを返す
  if (dbInitPromise) {
    return dbInitPromise;
  }

  dbInitPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB open error:', request.error);
      dbInitPromise = null; // エラー時はリセット
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      console.log('IndexedDB initialized successfully');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // オブジェクトストアが存在しない場合は作成
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = database.createObjectStore(STORE_NAME, { keyPath: 'url' });
        objectStore.createIndex('url', 'url', { unique: true });
        console.log('ObjectStore created:', STORE_NAME);
      }
    };
  });

  return dbInitPromise;
}

// URLをIndexedDBに追加
async function addUrlToDB(url) {
  // DBが初期化されていない場合は初期化を待つ
  if (!db) {
    try {
      await initDB();
    } catch (error) {
      throw new Error('Failed to initialize database: ' + error.message);
    }
  }

  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({ url: url, timestamp: Date.now() });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

// URLがIndexedDBに存在するかチェック
async function checkUrlInDB(url) {
  // DBが初期化されていない場合は初期化を待つ
  if (!db) {
    try {
      await initDB();
    } catch (error) {
      throw new Error('Failed to initialize database: ' + error.message);
    }
  }

  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(url);

      request.onsuccess = () => {
        resolve(!!request.result);
      };
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

// 履歴から一括でURLを取得してDBに保存
async function importHistoryToDB() {
  try {
    console.log('Starting history import...');
    importProgress.inProgress = true;
    importProgress.imported = 0;

    // 90日分の履歴を取得（ミリ秒単位）
    const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);

    const historyItems = await chrome.history.search({
      text: '',
      startTime: ninetyDaysAgo,
      maxResults: 0 // 0は制限なしを意味する
    });

    importProgress.total = historyItems.length;
    console.log(`Found ${historyItems.length} history items`);

    // バッチ処理で追加
    const batchSize = 100;
    for (let i = 0; i < historyItems.length; i += batchSize) {
      const batch = historyItems.slice(i, i + batchSize);
      await Promise.all(
        batch.map(item => addUrlToDB(item.url).catch(err => {
          console.warn('Failed to add URL:', item.url, err);
        }))
      );

      importProgress.imported = Math.min(i + batchSize, historyItems.length);

      if ((i + batchSize) % 1000 === 0) {
        console.log(`Imported ${i + batchSize} URLs...`);
      }
    }

    console.log('History import completed');

    // インポート完了フラグを保存
    await chrome.storage.local.set({
      historyImported: true,
      lastImportTime: Date.now()
    });

    importProgress.inProgress = false;
  } catch (error) {
    console.error('Error importing history:', error);
    importProgress.inProgress = false;
    throw error;
  }
}

// 初期化処理
async function initialize() {
  try {
    await initDB();

    // 初回起動かどうかをチェック
    const result = await chrome.storage.local.get(['historyImported']);

    if (!result.historyImported) {
      console.log('First run detected, importing history...');
      await importHistoryToDB();
    } else {
      console.log('History already imported');
    }
  } catch (error) {
    console.error('Initialization error:', error);
  }
}

// 拡張機能インストール時
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated');
  initialize();
});

// サービスワーカー起動時
initialize();

// URLを処理してDBに追加し、タブに通知する共通関数
async function processVisitedUrl(url) {
  if (!url) return;

  try {
    await addUrlToDB(url);

    // 全てのタブにURLが訪問済みになったことを通知
    const tabs = await chrome.tabs.query({});
    const notifications = tabs.map(tab =>
      chrome.tabs.sendMessage(tab.id, {
        action: 'markUrlAsVisited',
        url: url
      }).catch(() => {
        // タブがコンテンツスクリプトを持っていない場合はエラーを無視
      })
    );
    await Promise.all(notifications);
  } catch (err) {
    console.error('Failed to process visited URL:', url, err);
  }
}

// 新しい履歴アイテムをリアルタイムで追加
chrome.history.onVisited.addListener((historyItem) => {
  if (historyItem.url) {
    processVisitedUrl(historyItem.url);
  }
});

// タブの更新を監視してバックグラウンドで開かれたタブも処理
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // ページの読み込みが完了し、有効なURLがある場合のみ処理
  if (changeInfo.status === 'complete' && changeInfo.url &&
      !changeInfo.url.startsWith('chrome://') &&
      !changeInfo.url.startsWith('chrome-extension://') &&
      !changeInfo.url.startsWith('about:')) {
    processVisitedUrl(changeInfo.url);
  }
});

// DB内のURL数を取得
async function getUrlCount() {
  // DBが初期化されていない場合は初期化を待つ
  if (!db) {
    try {
      await initDB();
    } catch (error) {
      throw new Error('Failed to initialize database: ' + error.message);
    }
  }

  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

// DBをクリア
async function clearAllUrls() {
  // DBが初期化されていない場合は初期化を待つ
  if (!db) {
    try {
      await initDB();
    } catch (error) {
      throw new Error('Failed to initialize database: ' + error.message);
    }
  }

  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

// 全URLを取得
async function getAllUrls() {
  // DBが初期化されていない場合は初期化を待つ
  if (!db) {
    try {
      await initDB();
    } catch (error) {
      throw new Error('Failed to initialize database: ' + error.message);
    }
  }

  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

// 履歴をTSV形式でエクスポート
async function exportHistoryToTSV() {
  try {
    const allUrls = await getAllUrls();

    // TSVヘッダー
    let tsvContent = 'url\ttimestamp\n';

    // 各URLをTSV形式で追加
    allUrls.forEach(item => {
      // タブ、改行を含む場合はエスケープ
      const url = item.url.replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
      tsvContent += `${url}\t${item.timestamp}\n`;
    });

    console.log(`Exported ${allUrls.length} URLs to TSV`);
    return tsvContent;
  } catch (error) {
    console.error('Error exporting history to TSV:', error);
    throw error;
  }
}

// TSV形式から履歴をインポート
async function importHistoryFromTSV(tsvData) {
  try {
    const lines = tsvData.split('\n');
    let imported = 0;
    let errors = 0;

    // ヘッダー行をスキップ
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split('\t');
      if (parts.length < 2) {
        errors++;
        console.warn(`Invalid line ${i}: ${line}`);
        continue;
      }

      // エスケープされた文字を復元
      const url = parts[0].replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\r/g, '\r');
      const timestamp = parseInt(parts[1], 10);

      if (!url || isNaN(timestamp)) {
        errors++;
        console.warn(`Invalid data at line ${i}: url=${url}, timestamp=${timestamp}`);
        continue;
      }

      try {
        // DBが初期化されていない場合は初期化を待つ
        if (!db) {
          await initDB();
        }

        await new Promise((resolve, reject) => {
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.put({ url: url, timestamp: timestamp });

          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });

        imported++;
      } catch (error) {
        errors++;
        console.warn(`Failed to import URL at line ${i}:`, error);
      }
    }

    console.log(`Import completed: ${imported} imported, ${errors} errors`);
    return { imported, errors };
  } catch (error) {
    console.error('Error importing history from TSV:', error);
    throw error;
  }
}

// コンテンツスクリプトとポップアップからのメッセージを処理
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkUrl') {
    checkUrlInDB(request.url)
      .then(isVisited => {
        sendResponse({ isVisited });
      })
      .catch(error => {
        console.error('Error checking URL:', error);
        sendResponse({ isVisited: false });
      });

    // 非同期レスポンスのためtrueを返す
    return true;
  }

  if (request.action === 'checkUrls') {
    // 複数URLの一括チェック
    Promise.all(
      request.urls.map(url =>
        checkUrlInDB(url)
          .then(isVisited => ({ url, isVisited }))
          .catch(() => ({ url, isVisited: false }))
      )
    )
    .then(results => {
      sendResponse({ results });
    })
    .catch(error => {
      console.error('Error checking URLs:', error);
      sendResponse({ results: [] });
    });

    return true;
  }

  // ポップアップからの統計情報リクエスト
  if (request.action === 'getStats') {
    Promise.all([
      getUrlCount(),
      chrome.storage.local.get(['lastImportTime'])
    ])
    .then(([count, storage]) => {
      sendResponse({
        count,
        lastImportTime: storage.lastImportTime || null
      });
    })
    .catch(error => {
      console.error('Error getting stats:', error);
      sendResponse({ error: error.message });
    });

    return true;
  }

  // 履歴のインポートリクエスト
  if (request.action === 'importHistory') {
    if (importProgress.inProgress) {
      sendResponse({ error: 'Import already in progress' });
      return true;
    }

    importHistoryToDB()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Error importing history:', error);
        sendResponse({ error: error.message });
      });

    return true;
  }

  // インポート進行状況のリクエスト
  if (request.action === 'getImportProgress') {
    sendResponse(importProgress);
    return true;
  }

  // 履歴のクリアリクエスト
  if (request.action === 'clearHistory') {
    clearAllUrls()
      .then(() => {
        // フラグもリセット
        return chrome.storage.local.set({
          historyImported: false,
          lastImportTime: null
        });
      })
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Error clearing history:', error);
        sendResponse({ error: error.message });
      });

    return true;
  }

  // 履歴のエクスポート（TSV形式）
  if (request.action === 'exportHistory') {
    exportHistoryToTSV()
      .then(tsvData => {
        sendResponse({ success: true, data: tsvData });
      })
      .catch(error => {
        console.error('Error exporting history:', error);
        sendResponse({ error: error.message });
      });

    return true;
  }

  // 履歴のインポート（TSV形式）
  if (request.action === 'importFromTSV') {
    importHistoryFromTSV(request.tsvData)
      .then(result => {
        sendResponse({ success: true, imported: result.imported, errors: result.errors });
      })
      .catch(error => {
        console.error('Error importing from TSV:', error);
        sendResponse({ error: error.message });
      });

    return true;
  }
});
