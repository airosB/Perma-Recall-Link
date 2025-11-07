// i18n関数
function getMessage(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions);
}

// DOM要素に多言語テキストを適用
function localizeHtmlPage() {
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(element => {
    const key = element.getAttribute('data-i18n');
    const message = getMessage(key);
    if (message) {
      element.textContent = message;
    }
  });

  // バージョン表示
  const versionEl = document.getElementById('versionText');
  if (versionEl) {
    versionEl.textContent = getMessage('version', ['1.0.0']);
  }
}

// DOM要素の取得
const urlCountEl = document.getElementById('urlCount');
const lastImportEl = document.getElementById('lastImport');
const importBtn = document.getElementById('importBtn');
const clearBtn = document.getElementById('clearBtn');
const statusMessage = document.getElementById('statusMessage');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

// ステータスメッセージを表示
function showStatus(message, type = 'info') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  statusMessage.style.display = 'block';

  // 成功メッセージは3秒後に自動消去
  if (type === 'success') {
    setTimeout(() => {
      statusMessage.style.display = 'none';
    }, 3000);
  }
}

// プログレスバーを表示/更新
function updateProgress(percent, text = '') {
  progressBar.style.display = 'block';
  progressFill.style.width = `${percent}%`;
  progressText.textContent = text || `${percent}%`;
}

// プログレスバーを非表示
function hideProgress() {
  progressBar.style.display = 'none';
  progressFill.style.width = '0%';
}

// 統計情報を読み込み
async function loadStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getStats' });

    if (response.error) {
      urlCountEl.textContent = 'Error';
      return;
    }

    urlCountEl.textContent = response.count.toLocaleString();

    if (response.lastImportTime) {
      const date = new Date(response.lastImportTime);
      const locale = chrome.i18n.getUILanguage();
      lastImportEl.textContent = date.toLocaleString(locale);
    } else {
      lastImportEl.textContent = getMessage('statsNotExecuted');
    }
  } catch (error) {
    console.error('Failed to load stats:', error);
    urlCountEl.textContent = 'Error';
  }
}

// 履歴のインポート
async function importHistory() {
  if (!confirm(getMessage('importConfirm'))) {
    return;
  }

  importBtn.disabled = true;
  clearBtn.disabled = true;
  showStatus(getMessage('statusImporting'), 'info');
  updateProgress(0, getMessage('progressImporting'));

  try {
    // インポート開始
    const response = await chrome.runtime.sendMessage({ action: 'importHistory' });

    if (response.error) {
      showStatus(getMessage('statusError', [response.error]), 'error');
      hideProgress();
    } else {
      // 進行状況の監視
      const checkProgress = setInterval(async () => {
        const progressResponse = await chrome.runtime.sendMessage({ action: 'getImportProgress' });

        if (progressResponse.inProgress) {
          const percent = Math.round((progressResponse.imported / progressResponse.total) * 100);
          updateProgress(percent, `${progressResponse.imported} / ${progressResponse.total}`);
        } else {
          clearInterval(checkProgress);
          updateProgress(100, getMessage('progressComplete'));
          showStatus(getMessage('statusImportComplete', [progressResponse.imported.toString()]), 'success');

          setTimeout(() => {
            hideProgress();
            loadStats();
          }, 2000);

          importBtn.disabled = false;
          clearBtn.disabled = false;
        }
      }, 500);
    }
  } catch (error) {
    console.error('Import error:', error);
    showStatus(getMessage('statusError', [error.message]), 'error');
    hideProgress();
    importBtn.disabled = false;
    clearBtn.disabled = false;
  }
}

// 履歴のクリア
async function clearHistory() {
  if (!confirm(getMessage('clearConfirm'))) {
    return;
  }

  // 二重確認
  if (!confirm(getMessage('clearConfirm2'))) {
    return;
  }

  importBtn.disabled = true;
  clearBtn.disabled = true;
  showStatus(getMessage('statusClearing'), 'info');
  updateProgress(50, getMessage('progressClearing'));

  try {
    const response = await chrome.runtime.sendMessage({ action: 'clearHistory' });

    if (response.error) {
      showStatus(getMessage('statusError', [response.error]), 'error');
    } else {
      updateProgress(100, getMessage('progressComplete'));
      showStatus(getMessage('statusClearComplete'), 'success');

      setTimeout(() => {
        hideProgress();
        loadStats();
      }, 2000);
    }
  } catch (error) {
    console.error('Clear error:', error);
    showStatus(getMessage('statusError', [error.message]), 'error');
  } finally {
    setTimeout(() => {
      importBtn.disabled = false;
      clearBtn.disabled = false;
    }, 2000);
  }
}

// イベントリスナーの設定
importBtn.addEventListener('click', importHistory);
clearBtn.addEventListener('click', clearHistory);

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  localizeHtmlPage();
  loadStats();
});
