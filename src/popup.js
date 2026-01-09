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
const customCssInput = document.getElementById('customCss');
const saveCssBtn = document.getElementById('saveCssBtn');
const resetCssBtn = document.getElementById('resetCssBtn');
const previewLink = document.getElementById('previewLink');
const exportBtn = document.getElementById('exportBtn');
const importTsvBtn = document.getElementById('importTsvBtn');
const tsvFileInput = document.getElementById('tsvFileInput');

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

// デフォルトCSS
const DEFAULT_CSS = `a.extension-perma-recalled {
  border: 2px solid #0088AA !important;
  border-radius: 3px !important;
  padding: 2px 4px !important;
  background-color: rgba(0, 136, 170, 0.05) !important;
}`;

// カスタムCSSの読み込み
async function loadCustomCss() {
  try {
    const result = await chrome.storage.local.get(['customCss']);
    if (result.customCss !== undefined) {
      customCssInput.value = result.customCss;
      applyPreviewCss(result.customCss);
    } else {
      // 初回起動時はデフォルトCSSを表示
      customCssInput.value = DEFAULT_CSS;
    }
  } catch (error) {
    console.error('Failed to load custom CSS:', error);
    customCssInput.value = DEFAULT_CSS;
  }
}

// プレビューにCSSを適用
function applyPreviewCss(css) {
  // 既存のプレビュースタイルを削除
  const existingStyle = document.getElementById('preview-style');
  if (existingStyle) {
    existingStyle.remove();
  }

  // 新しいスタイルを追加
  if (css && css.trim()) {
    const style = document.createElement('style');
    style.id = 'preview-style';
    style.textContent = css;
    document.head.appendChild(style);
  }
}

// カスタムCSSの保存
async function saveCustomCss() {
  const css = customCssInput.value.trim();

  try {
    await chrome.storage.local.set({ customCss: css });

    // 全てのタブにメッセージを送信してCSSを更新
    const tabs = await chrome.tabs.query({});
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'updateCss',
        css: css
      }).catch(() => {
        // タブがコンテンツスクリプトを持っていない場合はエラーを無視
      });
    });

    applyPreviewCss(css);
    showStatus(getMessage('cssSaveSuccess') || 'CSS保存完了', 'success');
  } catch (error) {
    console.error('Failed to save custom CSS:', error);
    showStatus(getMessage('statusError', [error.message]), 'error');
  }
}

// CSSをデフォルトにリセット
async function resetCustomCss() {
  if (!confirm(getMessage('cssResetConfirm') || 'デフォルトスタイルに戻しますか？')) {
    return;
  }

  try {
    await chrome.storage.local.remove('customCss');
    customCssInput.value = DEFAULT_CSS;

    // 全てのタブにメッセージを送信してCSSをリセット
    const tabs = await chrome.tabs.query({});
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'updateCss',
        css: ''
      }).catch(() => {});
    });

    // プレビューのカスタムスタイルを削除
    const existingStyle = document.getElementById('preview-style');
    if (existingStyle) {
      existingStyle.remove();
    }

    showStatus(getMessage('cssResetSuccess') || 'デフォルトスタイルに戻しました', 'success');
  } catch (error) {
    console.error('Failed to reset CSS:', error);
    showStatus(getMessage('statusError', [error.message]), 'error');
  }
}

// CSS入力のリアルタイムプレビュー
customCssInput.addEventListener('input', () => {
  applyPreviewCss(customCssInput.value);
});

// 履歴のエクスポート（TSV）
async function exportHistory() {
  exportBtn.disabled = true;
  showStatus('エクスポート中...', 'info');

  try {
    const response = await chrome.runtime.sendMessage({ action: 'exportHistory' });

    if (response.error) {
      showStatus(`エラー: ${response.error}`, 'error');
    } else {
      // TSVデータをBlobとして作成
      const blob = new Blob([response.data], { type: 'text/tab-separated-values' });
      const url = URL.createObjectURL(blob);

      // ダウンロードリンクを作成
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().split('T')[0];
      a.download = `perma-recall-history-${date}.tsv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showStatus('エクスポート完了', 'success');
    }
  } catch (error) {
    console.error('Export error:', error);
    showStatus(`エラー: ${error.message}`, 'error');
  } finally {
    exportBtn.disabled = false;
  }
}

// 履歴のインポート（TSV）
async function importFromTSV() {
  tsvFileInput.click();
}

// TSVファイルの読み込みとインポート
async function handleTsvFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  importTsvBtn.disabled = true;
  showStatus('インポート中...', 'info');
  updateProgress(0, 'ファイル読み込み中...');

  try {
    const text = await file.text();

    updateProgress(50, 'データ処理中...');
    const response = await chrome.runtime.sendMessage({
      action: 'importFromTSV',
      tsvData: text
    });

    if (response.error) {
      showStatus(`エラー: ${response.error}`, 'error');
      hideProgress();
    } else {
      updateProgress(100, '完了');
      let message = `${response.imported}件をインポートしました`;
      if (response.errors > 0) {
        message += ` (${response.errors}件のエラー)`;
      }
      showStatus(message, 'success');

      setTimeout(() => {
        hideProgress();
        loadStats();
      }, 2000);
    }
  } catch (error) {
    console.error('Import from TSV error:', error);
    showStatus(`エラー: ${error.message}`, 'error');
    hideProgress();
  } finally {
    importTsvBtn.disabled = false;
    // ファイル入力をリセット
    tsvFileInput.value = '';
  }
}

// イベントリスナーの設定
importBtn.addEventListener('click', importHistory);
clearBtn.addEventListener('click', clearHistory);
saveCssBtn.addEventListener('click', saveCustomCss);
resetCssBtn.addEventListener('click', resetCustomCss);
exportBtn.addEventListener('click', exportHistory);
importTsvBtn.addEventListener('click', importFromTSV);
tsvFileInput.addEventListener('change', handleTsvFile);

// プレビューリンクのクリックを無効化
previewLink.addEventListener('click', (e) => {
  e.preventDefault();
});

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  localizeHtmlPage();
  loadStats();
  loadCustomCss();
});
