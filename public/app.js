// LinkVault Client Application
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const uploadSection = document.getElementById('upload-section');
  const resultSection = document.getElementById('result-section');
  const downloadSection = document.getElementById('download-section');
  const notFoundSection = document.getElementById('not-found-section');
  
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
  
  const dlFilename = document.getElementById('dl-filename');
  const dlSize = document.getElementById('dl-size');
  const dlExpires = document.getElementById('dl-expires');
  const dlRemaining = document.getElementById('dl-remaining');
  const dlPasswordContainer = document.getElementById('dl-password-container');
  const dlPassword = document.getElementById('dl-password');
  const btnTriggerDownload = document.getElementById('btn-trigger-download');
  
  let currentFileId = null;
  let currentDeleteToken = null;

  // Format bytes to human readable string
  function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  // Toast notification
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

  // Route handling
  const path = window.location.pathname;
  if (path.startsWith('/f/')) {
    const fileId = path.split('/')[2];
    if (fileId) {
      loadDownloadPage(fileId);
    } else {
      showNotFound();
    }
  }

  // Load Download Page Data
  async function loadDownloadPage(fileId) {
    currentFileId = fileId;
    uploadSection.style.display = 'none';
    resultSection.style.display = 'none';

    try {
      const response = await fetch(`/f/${fileId}`, {
        headers: { 'Accept': 'application/json' }
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
    
    // Format expiration
    const diff = file.expires_at - Date.now();
    if (diff <= 0) {
      showNotFound();
      return;
    }
    const hoursLeft = Math.ceil(diff / (1000 * 60 * 60));
    dlExpires.textContent = hoursLeft > 24 ? `${Math.ceil(hoursLeft / 24)}d left` : `${hoursLeft}h left`;

    // Format remaining downloads
    if (file.max_downloads !== null) {
      dlRemaining.textContent = `${file.remaining_downloads} of ${file.max_downloads}`;
    } else {
      dlRemaining.textContent = 'Unlimited';
    }

    // Password field visibility
    if (file.has_password) {
      dlPasswordContainer.style.display = 'block';
    } else {
      dlPasswordContainer.style.display = 'none';
    }

    downloadSection.style.display = 'block';
    notFoundSection.style.display = 'none';
  }

  function showNotFound() {
    uploadSection.style.display = 'none';
    resultSection.style.display = 'none';
    downloadSection.style.display = 'none';
    notFoundSection.style.display = 'block';
  }

  // Trigger Download
  btnTriggerDownload.addEventListener('click', async () => {
    btnTriggerDownload.disabled = true;
    btnTriggerDownload.textContent = 'Preparing download...';

    try {
      const body = {};
      if (dlPasswordContainer.style.display !== 'none') {
        body.password = dlPassword.value;
      }

      const response = await fetch(`/f/${currentFileId}/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (response.status === 403) {
        showToast('Incorrect password. Please try again.', 'error');
        btnTriggerDownload.disabled = false;
        btnTriggerDownload.textContent = 'Download File';
        return;
      }

      if (response.status === 404) {
        showToast('File no longer available or limit reached.', 'error');
        showNotFound();
        return;
      }

      if (!response.ok) {
        showToast('Download failed. Please try again.', 'error');
        btnTriggerDownload.disabled = false;
        btnTriggerDownload.textContent = 'Download File';
        return;
      }

      // Extract filename from Content-Disposition if present
      let filename = dlFilename.textContent || 'download';
      const disposition = response.headers.get('content-disposition');
      if (disposition && disposition.indexOf('filename=') !== -1) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
        if (matches != null && matches[1]) {
          filename = matches[1].replace(/['"]/g, '');
        }
      }

      // Convert to blob and download
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = decodeURIComponent(filename);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);

      showToast('Download started!', 'success');
      btnTriggerDownload.disabled = false;
      btnTriggerDownload.textContent = 'Download Again';

      // Refresh info to update remaining downloads
      loadDownloadPage(currentFileId);
    } catch (err) {
      console.error(err);
      showToast('Error downloading file.', 'error');
      btnTriggerDownload.disabled = false;
      btnTriggerDownload.textContent = 'Download File';
    }
  });

  // Password visibility toggle
  if (togglePassword) {
    togglePassword.addEventListener('click', () => {
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
    });
  }

  // Drag and drop handlers
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
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

  // Upload Form Submission
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
      resultExpiry.textContent = hoursLeft > 24 ? `Expires in ${Math.round(hoursLeft/24)}d` : `Expires in ${hoursLeft}h`;
      
      resultDownloads.textContent = data.max_downloads ? `Max ${data.max_downloads} download(s)` : 'Unlimited downloads';
      resultLock.style.display = data.has_password ? 'inline-block' : 'none';

      shareLinkInput.value = data.full_url || `${window.location.origin}${data.download_url}`;
      deleteTokenInput.value = data.delete_token;

      uploadSection.style.display = 'none';
      resultSection.style.display = 'flex';
      showToast('File uploaded successfully!', 'success');
    } catch (err) {
      console.error(err);
      showToast('Network error while uploading file.', 'error');
    } finally {
      btnUpload.disabled = false;
      uploadBtnText.textContent = 'Generate Secure Link';
    }
  });

  // Copy to clipboard handlers
  btnCopyLink.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareLinkInput.value);
      btnCopyLink.textContent = 'Copied!';
      showToast('Share link copied to clipboard!', 'success');
      setTimeout(() => btnCopyLink.textContent = 'Copy', 2000);
    } catch (err) {
      shareLinkInput.select();
      document.execCommand('copy');
      btnCopyLink.textContent = 'Copied!';
      setTimeout(() => btnCopyLink.textContent = 'Copy', 2000);
    }
  });

  btnCopyToken.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(deleteTokenInput.value);
      btnCopyToken.textContent = 'Copied!';
      showToast('Delete token copied!', 'success');
      setTimeout(() => btnCopyToken.textContent = 'Copy', 2000);
    } catch (err) {
      deleteTokenInput.select();
      document.execCommand('copy');
      btnCopyToken.textContent = 'Copied!';
      setTimeout(() => btnCopyToken.textContent = 'Copy', 2000);
    }
  });

  // Delete file now
  btnDeleteNow.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to permanently delete this file immediately?')) {
      return;
    }

    try {
      const response = await fetch(`/f/${currentFileId}`, {
        method: 'DELETE',
        headers: {
          'x-delete-token': currentDeleteToken
        }
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

  // Upload Another File
  btnUploadAnother.addEventListener('click', resetToUpload);

  function resetToUpload() {
    uploadForm.reset();
    filePreview.style.display = 'none';
    resultSection.style.display = 'none';
    downloadSection.style.display = 'none';
    notFoundSection.style.display = 'none';
    uploadSection.style.display = 'block';
  }
});
