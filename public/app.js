/**
 * LinkVault - Client Application Controller
 *
 * This file manages user interaction in the browser:
 * 1. Tab Switching between:
 *    - Vault Share: Server-stored expiring links with passwords and download limits.
 *    - Direct Beam P2P: Browser-to-browser WebRTC file streaming via room links.
 *    - Magic Wormhole: End-to-end encrypted transfer using a 3-word passphrase.
 * 2. Drag & Drop file selection.
 * 3. Form submission, progress meters, transfer speed, and ETA calculation.
 * 4. Clipboard copying and QR code rendering for mobile scanning.
 * 5. Reconnection triggers when a mobile user unlocks their screen or re-enters the tab.
 */

document.addEventListener('DOMContentLoaded', () => {
  // ==========================================================================
  // DOM ELEMENT REFERENCES
  // ==========================================================================

  // Vault Share UI sections
  const uploadSection = document.getElementById('upload-section');
  const resultSection = document.getElementById('result-section');
  const downloadSection = document.getElementById('download-section');
  const notFoundSection = document.getElementById('not-found-section');

  // Vault Upload Elements
  const uploadForm = document.getElementById('upload-form');
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const filePreview = document.getElementById('file-preview');
  const previewName = document.getElementById('preview-name');
  const previewSize = document.getElementById('preview-size');
  const btnRemoveFile = document.getElementById('btn-remove-file');
  const btnUpload = document.getElementById('btn-upload');
  const uploadBtnText = document.getElementById('upload-btn-text');

  const togglePassword = document.getElementById('toggle-password');
  const passwordInput = document.getElementById('password-input');

  // Vault Result Elements
  const resultFilename = document.getElementById('result-filename');
  const resultSize = document.getElementById('result-size');
  const resultExpiry = document.getElementById('result-expiry');
  const resultDownloads = document.getElementById('result-downloads');
  const resultLock = document.getElementById('result-lock');
  const shareLinkInput = document.getElementById('share-link-input');
  const deleteTokenInput = document.getElementById('delete-token-input');
  const btnCopyLink = document.getElementById('btn-copy-link');
  const btnCopyToken = document.getElementById('btn-copy-token');
  const btnDeleteNow = document.getElementById('btn-delete-now');
  const btnUploadAnother = document.getElementById('btn-upload-another');

  // Vault Download Elements
  const dlFilename = document.getElementById('dl-filename');
  const dlSize = document.getElementById('dl-size');
  const dlExpires = document.getElementById('dl-expires');
  const dlRemaining = document.getElementById('dl-remaining');
  const dlPasswordContainer = document.getElementById('dl-password-container');
  const dlPassword = document.getElementById('dl-password');
  const btnTriggerDownload = document.getElementById('btn-trigger-download');

  // Navigation Tabs
  const modeTabs = document.getElementById('mode-tabs');
  const tabVault = document.getElementById('tab-vault');
  const tabP2p = document.getElementById('tab-p2p');
  const tabWormhole = document.getElementById('tab-wormhole');
  const p2pSection = document.getElementById('p2p-section');
  const wormholeSection = document.getElementById('wormhole-section');
  const p2pReceiveSection = document.getElementById('p2p-receive-section');

  // P2P Direct Beam Elements
  const p2pDropzone = document.getElementById('p2p-dropzone');
  const p2pFileInput = document.getElementById('p2p-file-input');
  const p2pActivePanel = document.getElementById('p2p-active-panel');
  const p2pFileName = document.getElementById('p2p-file-name');
  const p2pFileSize = document.getElementById('p2p-file-size');
  const btnCancelP2p = document.getElementById('btn-cancel-p2p');
  const p2pShareLink = document.getElementById('p2p-share-link');
  const btnCopyP2pLink = document.getElementById('btn-copy-p2p-link');
  const p2pStatusIndicator = document.getElementById('p2p-status-indicator');
  const p2pStatusText = document.getElementById('p2p-status-text');
  const p2pProgressContainer = document.getElementById('p2p-progress-container');
  const p2pProgressFill = document.getElementById('p2p-progress-fill');
  const p2pProgressPercent = document.getElementById('p2p-progress-percent');
  const p2pSpeedText = document.getElementById('p2p-speed-text');
  const p2pEtaText = document.getElementById('p2p-eta-text');

  // P2P Receiver Elements
  const p2pRecvFilename = document.getElementById('p2p-recv-filename');
  const p2pRecvStatus = document.getElementById('p2p-recv-status');
  const p2pRecvStats = document.getElementById('p2p-recv-stats');
  const p2pRecvSize = document.getElementById('p2p-recv-size');
  const p2pRecvSpeed = document.getElementById('p2p-recv-speed');
  const p2pRecvPrompt = document.getElementById('p2p-recv-prompt');
  const btnAcceptBeam = document.getElementById('btn-accept-beam');
  const p2pRecvProgressBox = document.getElementById('p2p-recv-progress-box');
  const p2pRecvProgressFill = document.getElementById('p2p-recv-progress-fill');
  const p2pRecvProgressPercent = document.getElementById('p2p-recv-progress-percent');
  const p2pRecvEta = document.getElementById('p2p-recv-eta');
  const p2pRecvFallbackBox = document.getElementById('p2p-recv-fallback-box');
  const p2pFallbackText = document.getElementById('p2p-fallback-text');
  const btnReconnectBeamHost = document.getElementById('btn-reconnect-beam-host');
  const btnReconnectBeamPeer = document.getElementById('btn-reconnect-beam-peer');

  // Wormhole Elements
  const whDropzone = document.getElementById('wh-dropzone');
  const whFileInput = document.getElementById('wh-file-input');
  const whActive = document.getElementById('wh-active');
  const whFileName = document.getElementById('wh-file-name');
  const whFileSize = document.getElementById('wh-file-size');
  const btnCancelWh = document.getElementById('btn-cancel-wh');
  const whPhraseBox = document.getElementById('wh-phrase-box');
  const whPhrase = document.getElementById('wh-phrase');
  const btnCopyPhrase = document.getElementById('btn-copy-phrase');
  const whSendStatus = document.getElementById('wh-send-status');
  const whSendIndicator = document.getElementById('wh-send-indicator');
  const whSendStatusText = document.getElementById('wh-send-status-text');
  const whSendProgress = document.getElementById('wh-send-progress');
  const whSendFill = document.getElementById('wh-send-progress-fill');
  const whSendPercent = document.getElementById('wh-send-percent');
  const whSendSpeed = document.getElementById('wh-send-speed');
  const whSendEta = document.getElementById('wh-send-eta');

  const whRecvPhrase = document.getElementById('wh-recv-phrase');
  const btnWhConnect = document.getElementById('btn-wh-connect');
  const whRecvInputPanel = document.getElementById('wh-recv-input-panel');
  const whRecvActive = document.getElementById('wh-recv-active');
  const whRecvIndicator = document.getElementById('wh-recv-indicator');
  const whRecvStatusText = document.getElementById('wh-recv-status-text');
  const whRecvMeta = document.getElementById('wh-recv-meta');
  const whRecvFname = document.getElementById('wh-recv-fname');
  const whRecvFsize = document.getElementById('wh-recv-fsize');
  const btnWhAccept = document.getElementById('btn-wh-accept');
  const whRecvProgress = document.getElementById('wh-recv-progress');
  const whRecvFill = document.getElementById('wh-recv-progress-fill');
  const whRecvPercent = document.getElementById('wh-recv-percent');
  const whRecvSpeed = document.getElementById('wh-recv-speed');
  const whRecvEta = document.getElementById('wh-recv-eta');
  const whRecvError = document.getElementById('wh-recv-error');
  const whRecvErrorText = document.getElementById('wh-recv-error-text');
  const btnWhRetry = document.getElementById('btn-wh-retry');
  const btnReconnectWhSend = document.getElementById('btn-reconnect-wh-send');
  const btnReconnectWhRecv = document.getElementById('btn-reconnect-wh-recv');
  const whRecvDone = document.getElementById('wh-recv-done');
  const btnWhDownload = document.getElementById('btn-wh-download');

  // Application session states
  let currentFileId = null;
  let currentDeleteToken = null;
  let hostBeamSession = null;
  let peerBeamSession = null;
  let whSendSession = null;
  let whRecvSession = null;

  // ==========================================================================
  // HELPER FORMATTING FUNCTIONS
  // ==========================================================================

  /**
   * Formats raw bytes into a human-friendly string (e.g. 1048576 -> "1.00 MB").
   *
   * @param {number} bytes - Number of bytes.
   * @param {number} [decimals=2] - Number of decimal places.
   * @returns {string} Human-readable byte representation.
   */
  function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  /**
   * Formats duration in seconds into human-friendly time string (e.g. 90 -> "1m 30s").
   *
   * @param {number} seconds - Remaining time in seconds.
   * @returns {string} Formatted duration.
   */
  function formatEta(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--';
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  /**
   * Displays a floating toast notification message in the bottom-right corner.
   *
   * @param {string} message - Text to display.
   * @param {string} [type='info'] - Style category ('info', 'success', 'error').
   */
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  /**
   * Normalizes a human-entered Wormhole passphrase by stripping extra spaces,
   * converting to lowercase, and replacing em-dashes.
   *
   * @param {string} raw - Raw user input.
   * @returns {string} Cleaned hyphen-separated passphrase.
   */
  function cleanPassphrase(raw) {
    if (!raw) return '';
    return raw
      .toLowerCase()
      .trim()
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Copies text to the user's clipboard across desktop and mobile devices.
   *
   * @param {string} text - String to copy.
   * @param {HTMLElement} btnEl - Button element that was clicked.
   * @param {string} successMsg - Toast confirmation message.
   */
  async function copyText(text, btnEl, successMsg) {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      const originalText = btnEl.textContent;
      btnEl.textContent = '✅ Copied!';
      showToast(successMsg, 'success');
      setTimeout(() => { btnEl.textContent = originalText; }, 2000);
    } catch (e) {
      showToast('Please copy the text manually.', 'info');
    }
  }

  // ==========================================================================
  // ROUTE HANDLING (Single-Page App)
  // ==========================================================================

  const currentPath = window.location.pathname;

  if (currentPath.startsWith('/beam/')) {
    // URL format: /beam/:roomId -> open P2P Direct Beam receiver
    const roomId = currentPath.split('/')[2];
    if (roomId) {
      loadBeamPage(roomId);
    } else {
      showNotFound();
    }
  } else if (currentPath.startsWith('/f/')) {
    // URL format: /f/:fileId -> open Vault Share download page
    const fileId = currentPath.split('/')[2];
    if (fileId) {
      loadDownloadPage(fileId);
    } else {
      showNotFound();
    }
  }

  // ==========================================================================
  // TAB NAVIGATION
  // ==========================================================================

  function switchTab(activeTab) {
    [tabVault, tabP2p, tabWormhole].forEach((tab) => {
      if (tab) tab.classList.remove('active');
    });
    if (activeTab) activeTab.classList.add('active');

    uploadSection.style.display = (activeTab === tabVault) ? 'block' : 'none';
    resultSection.style.display = 'none';
    p2pSection.style.display = (activeTab === tabP2p) ? 'block' : 'none';
    wormholeSection.style.display = (activeTab === tabWormhole) ? 'block' : 'none';
  }

  if (tabVault) tabVault.addEventListener('click', () => switchTab(tabVault));
  if (tabP2p) tabP2p.addEventListener('click', () => switchTab(tabP2p));
  if (tabWormhole) tabWormhole.addEventListener('click', () => switchTab(tabWormhole));

  // ==========================================================================
  // VAULT SHARE: FILE UPLOAD
  // ==========================================================================

  // Password visibility toggle
  if (togglePassword) {
    togglePassword.addEventListener('click', () => {
      const isPasswordHidden = passwordInput.getAttribute('type') === 'password';
      passwordInput.setAttribute('type', isPasswordHidden ? 'text' : 'password');
    });
  }

  // Drag and drop events for file uploader
  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      handleFileSelected();
    }
  });

  fileInput.addEventListener('change', handleFileSelected);

  function handleFileSelected() {
    const file = fileInput.files[0];
    if (!file) return;

    // Validate 50 MB limit on client before sending
    if (file.size > 50 * 1024 * 1024) {
      showToast('File exceeds 50 MB limit.', 'error');
      fileInput.value = '';
      return;
    }

    previewName.textContent = file.name;
    previewSize.textContent = formatBytes(file.size);
    filePreview.style.display = 'flex';
  }

  btnRemoveFile.addEventListener('click', () => {
    fileInput.value = '';
    filePreview.style.display = 'none';
  });

  // Upload Form Submission to POST /upload
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = fileInput.files[0];
    if (!file) {
      showToast('Please select a file to upload.', 'error');
      return;
    }

    const formData = new FormData(uploadForm);
    btnUpload.disabled = true;
    uploadBtnText.textContent = 'Uploading & encrypting...';

    try {
      const response = await fetch('/upload', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        showToast(data.error || 'Upload failed.', 'error');
        btnUpload.disabled = false;
        uploadBtnText.textContent = 'Generate Secure Link';
        return;
      }

      // Display result view
      currentFileId = data.id;
      currentDeleteToken = data.delete_token;

      resultFilename.textContent = data.original_name;
      resultSize.textContent = formatBytes(data.size);

      const hoursLeft = Math.round((data.expires_at - Date.now()) / (1000 * 60 * 60));
      resultExpiry.textContent = hoursLeft > 24 ? `Expires in ${Math.round(hoursLeft / 24)}d` : `Expires in ${hoursLeft}h`;

      resultDownloads.textContent = data.max_downloads ? `Max ${data.max_downloads} download(s)` : 'Unlimited downloads';
      resultLock.style.display = data.has_password ? 'inline-block' : 'none';

      const finalShareUrl = data.full_url || `${window.location.origin}${data.download_url}`;
      shareLinkInput.value = finalShareUrl;
      deleteTokenInput.value = data.delete_token;

      // Update QR Code image for phone camera scanning
      const qrImg = document.getElementById('result-qr-img');
      if (qrImg && window.LinkVaultQR) {
        const svg = window.LinkVaultQR.generateSvg(finalShareUrl);
        qrImg.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      }

      uploadSection.style.display = 'none';
      resultSection.style.display = 'block';
      showToast('File uploaded successfully!', 'success');
    } catch (err) {
      console.error(err);
      showToast('Network error while uploading file.', 'error');
    } finally {
      btnUpload.disabled = false;
      uploadBtnText.textContent = 'Generate Secure Link';
    }
  });

  // Native Web Share API (mobile phones)
  const btnShareNative = document.getElementById('btn-share-native');
  if (btnShareNative && navigator.share) {
    btnShareNative.style.display = 'inline-flex';
    btnShareNative.addEventListener('click', async () => {
      try {
        await navigator.share({
          title: `LinkVault: ${resultFilename.textContent}`,
          text: `Download file "${resultFilename.textContent}" via LinkVault:`,
          url: shareLinkInput.value
        });
      } catch (err) {
        if (err && err.name !== 'AbortError') {
          showToast('Share failed. Use Copy instead.', 'info');
        }
      }
    });
  }

  // Copy button handlers
  btnCopyLink.addEventListener('click', () => {
    copyText(shareLinkInput.value, btnCopyLink, 'Share link copied to clipboard!');
  });

  btnCopyToken.addEventListener('click', () => {
    copyText(deleteTokenInput.value, btnCopyToken, 'Delete token copied!');
  });

  // Immediate deletion button
  btnDeleteNow.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to permanently delete this file immediately?')) {
      return;
    }

    try {
      const response = await fetch(`/f/${currentFileId}`, {
        method: 'DELETE',
        headers: { 'x-delete-token': currentDeleteToken }
      });

      if (response.ok) {
        showToast('File permanently deleted.', 'success');
        resetToUpload();
      } else {
        const data = await response.json();
        showToast(data.error || 'Failed to delete file.', 'error');
      }
    } catch (err) {
      showToast('Error deleting file.', 'error');
    }
  });

  btnUploadAnother.addEventListener('click', resetToUpload);

  function resetToUpload() {
    uploadForm.reset();
    filePreview.style.display = 'none';
    resultSection.style.display = 'none';
    downloadSection.style.display = 'none';
    notFoundSection.style.display = 'none';
    uploadSection.style.display = 'block';
  }

  // ==========================================================================
  // VAULT SHARE: DOWNLOAD PAGE
  // ==========================================================================

  async function loadDownloadPage(fileId) {
    currentFileId = fileId;
    uploadSection.style.display = 'none';
    resultSection.style.display = 'none';

    try {
      const response = await fetch(`/f/${fileId}`, {
        headers: { Accept: 'application/json' }
      });

      if (!response.ok) {
        showNotFound();
        return;
      }

      const file = await response.json();
      displayDownloadInfo(file);
    } catch (err) {
      console.error(err);
      showNotFound();
    }
  }

  function displayDownloadInfo(file) {
    dlFilename.textContent = file.original_name;
    dlSize.textContent = formatBytes(file.size);

    const diff = file.expires_at - Date.now();
    if (diff <= 0) {
      showNotFound();
      return;
    }
    const hoursLeft = Math.ceil(diff / (1000 * 60 * 60));
    dlExpires.textContent = hoursLeft > 24 ? `${Math.ceil(hoursLeft / 24)}d left` : `${hoursLeft}h left`;

    if (file.max_downloads !== null) {
      dlRemaining.textContent = `${file.remaining_downloads} of ${file.max_downloads}`;
    } else {
      dlRemaining.textContent = 'Unlimited';
    }

    dlPasswordContainer.style.display = file.has_password ? 'block' : 'none';
    downloadSection.style.display = 'block';
    notFoundSection.style.display = 'none';
  }

  function showNotFound() {
    uploadSection.style.display = 'none';
    resultSection.style.display = 'none';
    downloadSection.style.display = 'none';
    notFoundSection.style.display = 'block';
  }

  btnTriggerDownload.addEventListener('click', async () => {
    btnTriggerDownload.disabled = true;
    btnTriggerDownload.textContent = 'Preparing download...';

    const hasPassword = dlPasswordContainer.style.display !== 'none';
    const password = dlPassword ? dlPassword.value : '';

    if (hasPassword) {
      if (!password) {
        showToast('Please enter the password to download.', 'error');
        btnTriggerDownload.disabled = false;
        btnTriggerDownload.textContent = 'Download File';
        return;
      }

      // Pre-flight password verification: ensures incorrect password doesn't waste download limit!
      try {
        const verifyRes = await fetch(`/f/${currentFileId}/verify-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: password })
        });
        if (verifyRes.status === 403) {
          showToast('Incorrect password. Please try again.', 'error');
          btnTriggerDownload.disabled = false;
          btnTriggerDownload.textContent = 'Download File';
          return;
        }
        if (!verifyRes.ok) {
          showToast('File no longer available or limit reached.', 'error');
          showNotFound();
          return;
        }
      } catch (err) {
        showToast('Connection error. Please try again.', 'error');
        btnTriggerDownload.disabled = false;
        btnTriggerDownload.textContent = 'Download File';
        return;
      }
    }

    // Trigger native browser download manager using hidden POST form
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `/f/${currentFileId}/download`;
    form.style.display = 'none';

    if (hasPassword && password) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'password';
      input.value = password;
      form.appendChild(input);
    }

    document.body.appendChild(form);
    form.submit();

    setTimeout(() => {
      form.remove();
      showToast('Download started!', 'success');
      btnTriggerDownload.disabled = false;
      btnTriggerDownload.textContent = 'Download Again';
      loadDownloadPage(currentFileId);
    }, 1200);
  });

  // Manual Delete from Download Page
  const btnManualDelete = document.getElementById('btn-manual-delete');
  const manualDeleteToken = document.getElementById('manual-delete-token');
  if (btnManualDelete && manualDeleteToken) {
    btnManualDelete.addEventListener('click', async () => {
      const token = manualDeleteToken.value.trim();
      if (!token) {
        showToast('Please enter your delete token.', 'error');
        return;
      }
      if (!confirm('Are you sure you want to permanently delete this file?')) {
        return;
      }

      try {
        const response = await fetch(`/f/${currentFileId}`, {
          method: 'DELETE',
          headers: { 'x-delete-token': token }
        });

        if (response.ok) {
          showToast('File permanently deleted.', 'success');
          showNotFound();
        } else {
          const data = await response.json();
          showToast(data.error || 'Invalid delete token.', 'error');
        }
      } catch (err) {
        showToast('Error deleting file.', 'error');
      }
    });
  }

  // Global Purge from Footer
  const btnHomePurge = document.getElementById('btn-home-purge');
  const homeDelId = document.getElementById('home-del-id');
  const homeDelToken = document.getElementById('home-del-token');
  if (btnHomePurge && homeDelId && homeDelToken) {
    btnHomePurge.addEventListener('click', async () => {
      let rawId = homeDelId.value.trim();
      const token = homeDelToken.value.trim();
      if (!rawId || !token) {
        showToast('Please provide both the File ID/Link and Delete Token.', 'error');
        return;
      }

      if (rawId.includes('/f/')) {
        rawId = rawId.split('/f/')[1].split('/')[0].split('?')[0];
      }

      if (!confirm('Are you sure you want to permanently delete this file?')) {
        return;
      }

      try {
        const response = await fetch(`/f/${rawId}`, {
          method: 'DELETE',
          headers: { 'x-delete-token': token }
        });

        if (response.ok) {
          showToast('File permanently deleted.', 'success');
          homeDelId.value = '';
          homeDelToken.value = '';
        } else {
          const data = await response.json();
          showToast(data.error || 'File not found or invalid token.', 'error');
        }
      } catch (err) {
        showToast('Error deleting file.', 'error');
      }
    });
  }

  // ==========================================================================
  // DIRECT BEAM P2P SENDER & RECEIVER
  // ==========================================================================

  if (btnReconnectBeamHost) {
    btnReconnectBeamHost.addEventListener('click', () => {
      if (hostBeamSession) {
        p2pStatusText.textContent = 'Attempting manual reconnect…';
        hostBeamSession.checkAndReconnect();
      }
    });
  }
  if (btnReconnectBeamPeer) {
    btnReconnectBeamPeer.addEventListener('click', () => {
      if (peerBeamSession) {
        p2pRecvStatus.textContent = 'Attempting manual reconnect…';
        peerBeamSession.checkAndReconnect();
      }
    });
  }

  if (p2pFileInput) {
    p2pDropzone.addEventListener('click', () => p2pFileInput.click());

    p2pDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      p2pDropzone.classList.add('drag-active');
    });

    p2pDropzone.addEventListener('dragleave', () => {
      p2pDropzone.classList.remove('drag-active');
    });

    p2pDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      p2pDropzone.classList.remove('drag-active');
      if (e.dataTransfer.files.length > 0) {
        startP2pHost(e.dataTransfer.files[0]);
      }
    });

    p2pFileInput.addEventListener('change', () => {
      if (p2pFileInput.files.length > 0) {
        startP2pHost(p2pFileInput.files[0]);
      }
    });

    btnCancelP2p.addEventListener('click', () => {
      if (hostBeamSession) {
        hostBeamSession.abort();
        hostBeamSession = null;
      }
      p2pFileInput.value = '';
      p2pActivePanel.style.display = 'none';
      p2pDropzone.style.display = 'block';
    });

    btnCopyP2pLink.addEventListener('click', () => {
      if (!p2pShareLink.value) return;
      copyText(p2pShareLink.value, btnCopyP2pLink, 'Direct Beam link copied!');
    });
  }

  function startP2pHost(file) {
    p2pDropzone.style.display = 'none';
    p2pActivePanel.style.display = 'block';
    p2pFileName.textContent = file.name;
    p2pFileSize.textContent = formatBytes(file.size);
    p2pStatusIndicator.className = 'p2p-pulse';
    p2pStatusText.textContent = 'Generating secure room...';
    p2pProgressContainer.style.display = 'none';

    hostBeamSession = new BeamSession('host');

    hostBeamSession
      .on('onReady', ({ beamUrl }) => {
        p2pShareLink.value = beamUrl;
        p2pStatusText.textContent = 'Waiting for recipient to connect... Keep this tab open.';
      })
      .on('onStatus', (text, state) => {
        p2pStatusText.textContent = text;
        if (state === 'paused') {
          p2pStatusIndicator.className = 'p2p-pulse warning';
          if (btnReconnectBeamHost) btnReconnectBeamHost.style.display = 'inline-block';
        } else if (state === 'active') {
          p2pStatusIndicator.className = 'p2p-pulse active';
          if (btnReconnectBeamHost) btnReconnectBeamHost.style.display = 'none';
        }
      })
      .on('onPeerJoined', () => {
        p2pStatusIndicator.className = 'p2p-pulse active';
        p2pStatusText.textContent = 'Recipient connected! Direct P2P transfer active.';
        if (btnReconnectBeamHost) btnReconnectBeamHost.style.display = 'none';
        p2pProgressContainer.style.display = 'block';
      })
      .on('onProgress', (metrics) => {
        p2pProgressFill.style.width = `${metrics.percent}%`;
        p2pProgressPercent.textContent = `${Math.round(metrics.percent)}%`;
        p2pSpeedText.textContent = `${formatBytes(metrics.speedBps)}/s`;
        p2pEtaText.textContent = `ETA: ${formatEta(metrics.etaSeconds)}`;
      })
      .on('onComplete', () => {
        p2pStatusIndicator.className = 'p2p-pulse active';
        p2pStatusText.textContent = '⚡ Direct P2P transfer complete!';
        if (btnReconnectBeamHost) btnReconnectBeamHost.style.display = 'none';
        p2pProgressFill.style.width = '100%';
        p2pProgressPercent.textContent = '100%';
        p2pEtaText.textContent = 'Done';
        showToast('Transfer completed successfully!', 'success');
      })
      .on('onPeerLeft', (reason) => {
        p2pStatusIndicator.className = 'p2p-pulse error';
        p2pStatusText.textContent = `Peer disconnected (${reason}).`;
        if (btnReconnectBeamHost) btnReconnectBeamHost.style.display = 'inline-block';
      })
      .on('onError', (err) => {
        p2pStatusIndicator.className = 'p2p-pulse error';
        p2pStatusText.textContent = err;
        if (btnReconnectBeamHost) btnReconnectBeamHost.style.display = 'inline-block';
        showToast(err, 'error');
      });

    hostBeamSession.startHost(file).catch(() => {
      p2pStatusIndicator.className = 'p2p-pulse error';
      p2pStatusText.textContent = 'Failed to initialize signaling connection.';
    });
  }

  async function loadBeamPage(roomId) {
    if (modeTabs) modeTabs.style.display = 'none';
    uploadSection.style.display = 'none';
    resultSection.style.display = 'none';
    downloadSection.style.display = 'none';
    p2pSection.style.display = 'none';
    p2pReceiveSection.style.display = 'block';

    peerBeamSession = new BeamSession('peer', roomId);

    peerBeamSession
      .on('onMeta', (meta) => {
        p2pRecvFilename.textContent = meta.name;
        p2pRecvStatus.textContent = 'Connected to sender. Ready to stream directly to disk.';
        p2pRecvSize.textContent = formatBytes(meta.size);
        p2pRecvStats.style.display = 'grid';
        p2pRecvPrompt.style.display = 'block';
        if (btnReconnectBeamPeer) btnReconnectBeamPeer.style.display = 'none';
      })
      .on('onStatus', (text, state) => {
        p2pRecvStatus.textContent = text;
        if (state === 'paused') {
          if (btnReconnectBeamPeer) btnReconnectBeamPeer.style.display = 'inline-block';
        } else if (state === 'active') {
          if (btnReconnectBeamPeer) btnReconnectBeamPeer.style.display = 'none';
        }
      })
      .on('onProgress', (metrics) => {
        p2pRecvProgressFill.style.width = `${metrics.percent}%`;
        p2pRecvProgressPercent.textContent = `${Math.round(metrics.percent)}%`;
        p2pRecvSpeed.textContent = `${formatBytes(metrics.speedBps)}/s`;
        p2pRecvEta.textContent = `ETA: ${formatEta(metrics.etaSeconds)}`;
      })
      .on('onComplete', () => {
        p2pRecvStatus.textContent = '✅ Transfer finished! File saved.';
        if (btnReconnectBeamPeer) btnReconnectBeamPeer.style.display = 'none';
        p2pRecvProgressFill.style.width = '100%';
        p2pRecvProgressPercent.textContent = '100%';
        p2pRecvEta.textContent = 'Complete';
        showToast('File downloaded and saved to disk!', 'success');
      })
      .on('onPeerLeft', (reason) => {
        p2pRecvStatus.textContent = `Sender disconnected: ${reason}`;
        if (btnReconnectBeamPeer) btnReconnectBeamPeer.style.display = 'inline-block';
      })
      .on('onError', (err) => {
        p2pRecvStatus.textContent = 'Connection error: ' + err;
        p2pFallbackText.textContent = err;
        p2pRecvFallbackBox.style.display = 'block';
        if (btnReconnectBeamPeer) btnReconnectBeamPeer.style.display = 'inline-block';
      });

    btnAcceptBeam.addEventListener('click', async () => {
      btnAcceptBeam.disabled = true;
      btnAcceptBeam.textContent = 'Streaming...';
      p2pRecvProgressBox.style.display = 'block';
      p2pRecvPrompt.style.display = 'none';

      const accepted = await peerBeamSession.acceptTransfer();
      if (!accepted) {
        btnAcceptBeam.disabled = false;
        btnAcceptBeam.textContent = '⚡ Accept & Start Transfer';
        p2pRecvPrompt.style.display = 'block';
        p2pRecvProgressBox.style.display = 'none';
      }
    });

    try {
      await peerBeamSession.startPeer(roomId);
    } catch (err) {
      p2pRecvStatus.textContent = 'Failed to connect to signaling room.';
      p2pFallbackText.textContent = 'Room expired or peer unreachable.';
      p2pRecvFallbackBox.style.display = 'block';
    }
  }

  // ==========================================================================
  // WORMHOLE SENDER & RECEIVER
  // ==========================================================================

  if (btnReconnectWhSend) {
    btnReconnectWhSend.addEventListener('click', () => {
      if (whSendSession) {
        whSendStatusText.textContent = 'Attempting manual reconnect…';
        whSendSession.checkAndReconnect();
      }
    });
  }

  if (btnReconnectWhRecv) {
    btnReconnectWhRecv.addEventListener('click', () => {
      if (whRecvSession) {
        whRecvStatusText.textContent = 'Attempting manual reconnect…';
        whRecvSession.checkAndReconnect();
      }
    });
  }

  if (whDropzone && whFileInput) {
    whDropzone.addEventListener('click', () => whFileInput.click());
    whDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      whDropzone.classList.add('drag-active');
    });
    whDropzone.addEventListener('dragleave', () => whDropzone.classList.remove('drag-active'));
    whDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      whDropzone.classList.remove('drag-active');
      if (e.dataTransfer.files[0]) startWhSend(e.dataTransfer.files[0]);
    });
    whFileInput.addEventListener('change', () => {
      if (whFileInput.files[0]) startWhSend(whFileInput.files[0]);
    });

    btnCancelWh.addEventListener('click', () => {
      if (whSendSession) {
        whSendSession.abort();
        whSendSession = null;
      }
      whFileInput.value = '';
      whActive.style.display = 'none';
      whDropzone.style.display = 'block';
    });

    btnCopyPhrase.addEventListener('click', () => {
      copyText(whPhrase.textContent, btnCopyPhrase, 'Passphrase copied to clipboard!');
    });
  }

  function startWhSend(file) {
    whDropzone.style.display = 'none';
    whActive.style.display = 'block';
    whFileName.textContent = file.name;
    whFileSize.textContent = formatBytes(file.size);

    whPhraseBox.style.display = 'none';
    whSendStatus.style.display = 'block';
    whSendProgress.style.display = 'none';
    whSendIndicator.className = 'p2p-pulse';
    whSendStatusText.textContent = 'Deriving secure room key… (one moment)';

    whSendSession = new WormholeSession('sender');

    whSendSession
      .on('onPassphrase', (phrase) => {
        whPhrase.textContent = phrase;
      })
      .on('onDeriving', () => {
        whSendStatusText.textContent = 'Deriving secure room key…';
      })
      .on('onReady', () => {
        whPhraseBox.style.display = 'block';
        whSendStatusText.textContent = 'Waiting for recipient to enter the passphrase…';
        if (btnReconnectWhSend) btnReconnectWhSend.style.display = 'none';
        showToast('Passphrase ready! Share it with your recipient.', 'info');
      })
      .on('onStatus', (text, state) => {
        whSendStatusText.textContent = text;
        if (state === 'paused') {
          whSendIndicator.className = 'p2p-pulse warning';
          if (btnReconnectWhSend) btnReconnectWhSend.style.display = 'inline-block';
        } else if (state === 'active') {
          whSendIndicator.className = 'p2p-pulse active';
          if (btnReconnectWhSend) btnReconnectWhSend.style.display = 'none';
        }
      })
      .on('onPeerJoined', () => {
        whSendIndicator.className = 'p2p-pulse active';
        whSendStatusText.textContent = 'Recipient connected — transferring encrypted file…';
        if (btnReconnectWhSend) btnReconnectWhSend.style.display = 'none';
        whSendProgress.style.display = 'block';
      })
      .on('onProgress', (metrics) => {
        whSendFill.style.width = `${metrics.percent}%`;
        whSendPercent.textContent = `${Math.round(metrics.percent)}%`;
        whSendSpeed.textContent = `${formatBytes(metrics.speedBps)}/s`;
        whSendEta.textContent = `ETA: ${formatEta(metrics.etaSeconds)}`;
      })
      .on('onComplete', () => {
        whSendIndicator.className = 'p2p-pulse active';
        whSendStatusText.textContent = '🔮 Wormhole transfer complete!';
        if (btnReconnectWhSend) btnReconnectWhSend.style.display = 'none';
        whSendFill.style.width = '100%';
        whSendPercent.textContent = '100%';
        whSendEta.textContent = 'Done';
        showToast('Wormhole transfer completed!', 'success');
      })
      .on('onPeerLeft', (reason) => {
        whSendIndicator.className = 'p2p-pulse error';
        whSendStatusText.textContent = `Peer disconnected: ${reason}`;
        if (btnReconnectWhSend) btnReconnectWhSend.style.display = 'inline-block';
      })
      .onError = (err) => {
        whSendIndicator.className = 'p2p-pulse error';
        whSendStatusText.textContent = err;
        if (btnReconnectWhSend) btnReconnectWhSend.style.display = 'inline-block';
        showToast(err, 'error');
      };

    whSendSession.startSender(file).catch(() => {
      whSendIndicator.className = 'p2p-pulse error';
      whSendStatusText.textContent = 'Failed to start wormhole. Check your connection.';
    });
  }

  // Wormhole Receiver Flow
  if (btnWhConnect) {
    btnWhConnect.addEventListener('click', () => {
      const phrase = cleanPassphrase(whRecvPhrase.value);
      if (!phrase) {
        showToast('Please enter the passphrase from the sender.', 'error');
        return;
      }
      startWhReceive(phrase);
    });

    whRecvPhrase.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnWhConnect.click();
    });
  }

  if (btnWhRetry) {
    btnWhRetry.addEventListener('click', () => {
      whRecvActive.style.display = 'none';
      whRecvInputPanel.style.display = 'block';
      whRecvError.style.display = 'none';
      whRecvMeta.style.display = 'none';
      whRecvProgress.style.display = 'none';
      if (whRecvDone) whRecvDone.style.display = 'none';
      if (btnReconnectWhRecv) btnReconnectWhRecv.style.display = 'none';
      if (whRecvSession) {
        whRecvSession.abort();
        whRecvSession = null;
      }
    });
  }

  function startWhReceive(phrase) {
    whRecvInputPanel.style.display = 'none';
    whRecvActive.style.display = 'block';
    whRecvError.style.display = 'none';
    whRecvMeta.style.display = 'none';
    whRecvProgress.style.display = 'none';
    if (whRecvDone) whRecvDone.style.display = 'none';
    if (btnReconnectWhRecv) btnReconnectWhRecv.style.display = 'none';
    whRecvIndicator.className = 'p2p-pulse';
    whRecvStatusText.textContent = 'Deriving secure key… (one moment)';

    whRecvSession = new WormholeSession('receiver');

    whRecvSession
      .on('onDeriving', () => {
        whRecvStatusText.textContent = 'Deriving secure key from passphrase…';
      })
      .on('onStatus', (text, state) => {
        whRecvStatusText.textContent = text;
        if (state === 'paused') {
          whRecvIndicator.className = 'p2p-pulse warning';
          if (btnReconnectWhRecv) btnReconnectWhRecv.style.display = 'inline-block';
        } else if (state === 'active') {
          whRecvIndicator.className = 'p2p-pulse active';
          if (btnReconnectWhRecv) btnReconnectWhRecv.style.display = 'none';
        }
      })
      .on('onMeta', (meta) => {
        whRecvStatusText.textContent = 'Connected to sender — ready to receive.';
        whRecvIndicator.className = 'p2p-pulse active';
        if (btnReconnectWhRecv) btnReconnectWhRecv.style.display = 'none';
        whRecvFname.textContent = meta.name;
        whRecvFsize.textContent = formatBytes(meta.size);
        whRecvMeta.style.display = 'block';
      })
      .on('onProgress', (metrics) => {
        whRecvFill.style.width = `${metrics.percent}%`;
        whRecvPercent.textContent = `${Math.round(metrics.percent)}%`;
        whRecvSpeed.textContent = `${formatBytes(metrics.speedBps)}/s`;
        whRecvEta.textContent = `ETA: ${formatEta(metrics.etaSeconds)}`;
      })
      .on('onComplete', (info) => {
        whRecvIndicator.className = 'p2p-pulse active';
        whRecvStatusText.textContent = '✅ Transfer complete! File received.';
        whRecvFill.style.width = '100%';
        whRecvPercent.textContent = '100%';
        whRecvEta.textContent = 'Done';
        if (btnReconnectWhRecv) btnReconnectWhRecv.style.display = 'none';

        if (info && info.downloadUrl) {
          if (whRecvDone && btnWhDownload) {
            btnWhDownload.href = info.downloadUrl;
            btnWhDownload.download = info.name || 'received_file';
            btnWhDownload.textContent = `💾 Download ${info.name || 'File'} (${formatBytes(info.size || 0)})`;
            whRecvDone.style.display = 'block';
          }
        }
        showToast('File received successfully!', 'success');
      })
      .on('onPeerLeft', (reason) => {
        whRecvIndicator.className = 'p2p-pulse error';
        whRecvStatusText.textContent = `Sender disconnected: ${reason}`;
        if (btnReconnectWhRecv) btnReconnectWhRecv.style.display = 'inline-block';
      })
      .on('onError', (err) => {
        whRecvIndicator.className = 'p2p-pulse error';
        whRecvErrorText.textContent = err;
        whRecvError.style.display = 'block';
        if (btnReconnectWhRecv) btnReconnectWhRecv.style.display = 'inline-block';
      });

    whRecvSession.startReceiver(phrase).catch(() => {
      whRecvErrorText.textContent = 'Failed to connect. Check the passphrase and try again.';
      whRecvError.style.display = 'block';
      if (btnReconnectWhRecv) btnReconnectWhRecv.style.display = 'inline-block';
    });
  }

  if (btnWhAccept) {
    btnWhAccept.addEventListener('click', async () => {
      if (!whRecvSession) return;
      btnWhAccept.disabled = true;
      btnWhAccept.textContent = 'Opening file saver…';
      whRecvProgress.style.display = 'block';

      const accepted = await whRecvSession.acceptTransfer();
      if (!accepted) {
        btnWhAccept.disabled = false;
        btnWhAccept.textContent = '⚡ Accept & Save File';
        whRecvProgress.style.display = 'none';
        return;
      }
      btnWhAccept.textContent = 'Receiving…';
    });
  }

  // Reconnection trigger when returning to browser tab
  const resumeActiveSessions = () => {
    if (document.visibilityState === 'visible') {
      [hostBeamSession, peerBeamSession, whSendSession, whRecvSession].forEach((s) => {
        if (s && typeof s.checkAndReconnect === 'function') s.checkAndReconnect();
      });
    }
  };

  document.addEventListener('visibilitychange', resumeActiveSessions);
  window.addEventListener('online', resumeActiveSessions);
  window.addEventListener('focus', resumeActiveSessions);
});
