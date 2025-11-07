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
      urlCountEl.textContent = 'エラー';
      return;
    }

    urlCountEl.textContent = response.count.toLocaleString();

    if (response.lastImportTime) {
      const date = new Date(response.lastImportTime);
      lastImportEl.textContent = date.toLocaleString('ja-JP');
    } else {
      lastImportEl.textContent = '未実行';
    }
  } catch (error) {
    console.error('Failed to load stats:', error);
    urlCountEl.textContent = 'エラー';
  }
}

// 履歴のインポート
async function importHistory() {
  if (!confirm('過去90日分の履歴を再インポートしますか？\n既存のデータは保持されたまま、新しいURLが追加されます。')) {
    return;
  }

  importBtn.disabled = true;
  clearBtn.disabled = true;
  showStatus('履歴をインポート中...', 'info');
  updateProgress(0, 'インポート中...');

  try {
    // インポート開始
    const response = await chrome.runtime.sendMessage({ action: 'importHistory' });

    if (response.error) {
      showStatus(`エラー: ${response.error}`, 'error');
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
          updateProgress(100, '完了');
          showStatus(`インポート完了: ${progressResponse.imported} 件のURLを処理しました`, 'success');

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
    showStatus(`インポートエラー: ${error.message}`, 'error');
    hideProgress();
    importBtn.disabled = false;
    clearBtn.disabled = false;
  }
}

// 履歴のクリア
async function clearHistory() {
  if (!confirm('保存されている全ての訪問履歴データを削除しますか？\n\n⚠️ この操作は元に戻せません！')) {
    return;
  }

  // 二重確認
  if (!confirm('本当に削除しますか？全てのデータが失われます。')) {
    return;
  }

  importBtn.disabled = true;
  clearBtn.disabled = true;
  showStatus('履歴をクリア中...', 'info');
  updateProgress(50, 'クリア中...');

  try {
    const response = await chrome.runtime.sendMessage({ action: 'clearHistory' });

    if (response.error) {
      showStatus(`エラー: ${response.error}`, 'error');
    } else {
      updateProgress(100, '完了');
      showStatus('履歴データを全て削除しました', 'success');

      setTimeout(() => {
        hideProgress();
        loadStats();
      }, 2000);
    }
  } catch (error) {
    console.error('Clear error:', error);
    showStatus(`クリアエラー: ${error.message}`, 'error');
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
  loadStats();
});
