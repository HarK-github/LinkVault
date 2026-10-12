/**
 * LinkVault P2P Cache - Lightweight Transfer Resume Store
 * Uses browser localStorage for synchronous, zero-overhead progress tracking.
 */

window.LinkVaultCache = {
  async saveResumeRecord(fileId, lastContiguousChunk, totalChunks) {
    try {
      localStorage.setItem(`lv_resume_${fileId}`, JSON.stringify({
        fileId,
        lastContiguousChunk,
        totalChunks,
        updatedAt: Date.now()
      }));
      return true;
    } catch (err) {
      return false;
    }
  },

  async getResumeRecord(fileId) {
    try {
      const item = localStorage.getItem(`lv_resume_${fileId}`);
      return item ? JSON.parse(item) : null;
    } catch (err) {
      return null;
    }
  },

  async clearResumeRecord(fileId) {
    try {
      localStorage.removeItem(`lv_resume_${fileId}`);
      return true;
    } catch (err) {
      return false;
    }
  }
};
