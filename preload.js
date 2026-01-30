const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Get list of saved recordings
    getRecordings: () => ipcRenderer.invoke('get-recordings'),

    // Save a new recording (legacy, for small files)
    saveRecording: (buffer, filename) =>
        ipcRenderer.invoke('save-recording', { buffer, filename }),

    // Delete a recording
    deleteRecording: (filename) =>
        ipcRenderer.invoke('delete-recording', filename),

    // Get recordings directory path
    getRecordingsPath: () => ipcRenderer.invoke('get-recordings-path'),

    // Show file in Finder
    showInFinder: (filePath) => ipcRenderer.invoke('show-in-finder', filePath),

    // Select folder dialog
    selectFolder: () => ipcRenderer.invoke('select-folder'),

    // Storage path management
    getStoragePath: () => ipcRenderer.invoke('get-storage-path'),
    setStoragePath: (path) => ipcRenderer.invoke('set-storage-path', path),
    resetStoragePath: () => ipcRenderer.invoke('reset-storage-path'),

    // Convert WebM to MP3
    convertToMp3: (inputPath) => ipcRenderer.invoke('convert-to-mp3', inputPath),

    // Transcribe audio (local or OpenAI)
    transcribeAudio: (audioPath, method, apiKey) =>
        ipcRenderer.invoke('transcribe-audio', { audioPath, method, apiKey }),

    // Check if local Whisper is available
    checkLocalWhisper: () => ipcRenderer.invoke('check-local-whisper'),

    // ===== Streaming Recording for Long Meetings =====
    // These methods flush audio data to disk periodically to prevent data loss
    // Writes to temp folder during recording, then atomically moves to final location
    
    // Start a streaming recording - creates temp file
    startStreamingRecording: (recordingId, filename) => 
        ipcRenderer.invoke('start-streaming-recording', { recordingId, filename }),
    
    // Append audio chunk to temp file
    appendAudioChunk: (recordingId, chunk) => 
        ipcRenderer.invoke('append-audio-chunk', { recordingId, chunk }),
    
    // Flush (sync) the temp file to ensure data is written to disk
    flushAudioFile: (recordingId) => 
        ipcRenderer.invoke('flush-audio-file', recordingId),
    
    // Finalize recording - close temp file and atomically move to final location
    finalizeRecording: (recordingId) => 
        ipcRenderer.invoke('finalize-recording', { recordingId }),
    
    // Cancel/abandon recording - delete temp file
    cancelRecording: (recordingId) => 
        ipcRenderer.invoke('cancel-recording', recordingId),
    
    // Check for incomplete recordings (for crash recovery)
    checkIncompleteRecordings: () => 
        ipcRenderer.invoke('check-incomplete-recordings'),
    
    // Recover incomplete recording - move temp file to final location
    recoverRecording: (recordingId, filename) => 
        ipcRenderer.invoke('recover-recording', { recordingId, filename }),
    
    // Delete incomplete recording
    deleteIncompleteRecording: (recordingId) => 
        ipcRenderer.invoke('delete-incomplete-recording', recordingId)
});
