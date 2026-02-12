const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

// Settings file path (lazy loaded)
let settingsPath;
let tempRecordingsDir;

function initPaths() {
  if (!settingsPath) {
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
    tempRecordingsDir = path.join(app.getPath('userData'), 'temp_recordings');
    
    // Ensure temp directory exists
    if (!fs.existsSync(tempRecordingsDir)) {
      fs.mkdirSync(tempRecordingsDir, { recursive: true });
    }
  }
}

// Load settings
function loadSettings() {
  initPaths();
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  return {};
}

// Save settings
function saveSettings(settings) {
  initPaths();
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

// Get recordings directory (custom or default)
function getRecordingsDir() {
  const settings = loadSettings();
  const customPath = settings.recordingsPath;

  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }

  // Default path
  const defaultDir = path.join(app.getPath('userData'), 'recordings');
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  return defaultDir;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 700,
    minWidth: 400,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Handle screen sharing / display media requests properly
  const { session, desktopCapturer } = require('electron');

  // Set up handler for getDisplayMedia - allow audio capture
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      // Grant request to the first available source with audio
      // On macOS, we need loopback audio which requires user to configure
      if (sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' });
      } else {
        callback({});
      }
    });
  });

  mainWindow.loadFile('src/renderer/index.html');

  // Open DevTools in development
  if (process.argv.includes('--enable-logging')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers

// Get list of recordings
ipcMain.handle('get-recordings', async () => {
  try {
    const recordingsDir = getRecordingsDir();
    const files = fs.readdirSync(recordingsDir);
    const recordings = files
      .filter(file => file.endsWith('.webm') || file.endsWith('.wav'))
      .map(file => {
        const filePath = path.join(recordingsDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          path: filePath,
          size: stats.size,
          createdAt: stats.birthtime.toISOString(),
          duration: null // Will be calculated on frontend
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return recordings;
  } catch (error) {
    console.error('Error reading recordings:', error);
    return [];
  }
});

// Save recording
ipcMain.handle('save-recording', async (event, { buffer, filename }) => {
  try {
    const recordingsDir = getRecordingsDir();
    const filePath = path.join(recordingsDir, filename);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return { success: true, path: filePath };
  } catch (error) {
    console.error('Error saving recording:', error);
    return { success: false, error: error.message };
  }
});

// Delete recording
ipcMain.handle('delete-recording', async (event, filename) => {
  try {
    const recordingsDir = getRecordingsDir();
    const filePath = path.join(recordingsDir, filename);
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (error) {
    console.error('Error deleting recording:', error);
    return { success: false, error: error.message };
  }
});

// Get recordings directory path
ipcMain.handle('get-recordings-path', () => {
  return getRecordingsDir();
});

// Show recording in Finder
ipcMain.handle('show-in-finder', async (event, filePath) => {
  shell.showItemInFolder(filePath);
});

// Select folder dialog
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Recordings Folder'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Get storage path setting
ipcMain.handle('get-storage-path', () => {
  return getRecordingsDir();
});

// Set storage path setting
ipcMain.handle('set-storage-path', async (event, newPath) => {
  try {
    // Verify path exists or can be created
    if (!fs.existsSync(newPath)) {
      fs.mkdirSync(newPath, { recursive: true });
    }

    const settings = loadSettings();
    settings.recordingsPath = newPath;
    saveSettings(settings);

    return { success: true, path: newPath };
  } catch (error) {
    console.error('Error setting storage path:', error);
    return { success: false, error: error.message };
  }
});

// Reset to default storage path
ipcMain.handle('reset-storage-path', async () => {
  const settings = loadSettings();
  delete settings.recordingsPath;
  saveSettings(settings);

  const defaultDir = path.join(app.getPath('userData'), 'recordings');
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  return defaultDir;
});

// Convert WebM to MP3 using FFmpeg
ipcMain.handle('convert-to-mp3', async (event, inputPath) => {
  const { spawn } = require('child_process');

  return new Promise((resolve) => {
    const outputPath = inputPath.replace(/\.webm$/i, '.mp3');

    // Check if output already exists
    if (fs.existsSync(outputPath)) {
      return resolve({ success: true, path: outputPath, alreadyExists: true });
    }

    // Find ffmpeg path - prioritize bundled ffmpeg, then system paths
    // In packaged app, ffmpeg is in extraResources (Contents/Resources on macOS)
    const resourcesPath = process.resourcesPath;
    const ffmpegPaths = [
      path.join(__dirname, 'ffmpeg'),                                    // Dev: project root
      path.join(__dirname, '..', 'ffmpeg'),                            // Dev: parent of src
      path.join(resourcesPath, 'ffmpeg'),                              // Packaged: extraResources
      path.join(resourcesPath, 'app', 'ffmpeg'),                       // Alternative location
      path.join(resourcesPath, 'app.asar.unpacked', 'ffmpeg'),         // Unpacked from asar
      path.join(app.getAppPath(), 'ffmpeg'),                           // App root
      '/opt/homebrew/bin/ffmpeg',                                      // Homebrew (Apple Silicon)
      '/usr/local/bin/ffmpeg',                                         // Homebrew (Intel)
      '/usr/bin/ffmpeg',                                               // System
      'ffmpeg'                                                         // PATH
    ];

    let ffmpegPath = 'ffmpeg';
    for (const p of ffmpegPaths) {
      if (!p.includes('.asar') && fs.existsSync(p)) {
        ffmpegPath = p;
        break;
      }
    }

    const ffmpeg = spawn(ffmpegPath, [
      '-i', inputPath,
      '-vn',
      '-acodec', 'libmp3lame',
      '-ab', '64k',
      '-ar', '22050',
      '-ac', '1',
      '-y',
      outputPath
    ]);

    let errorOutput = '';

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve({ success: true, path: outputPath });
      } else {
        resolve({ success: false, error: `FFmpeg exited with code ${code}: ${errorOutput}` });
      }
    });

    ffmpeg.on('error', (err) => {
      resolve({ success: false, error: `Failed to start FFmpeg: ${err.message}` });
    });
  });
});

// Transcribe audio using Python script (supports local Whisper and OpenAI API)
ipcMain.handle('transcribe-audio', async (event, { audioPath, method, apiKey }) => {
  const { spawn } = require('child_process');

  return new Promise((resolve) => {
    // Find Python path
    const pythonPaths = [
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      '/usr/bin/python3',
      'python3',
      'python'
    ];

    let pythonPath = 'python3';
    for (const p of pythonPaths) {
      if (fs.existsSync(p)) {
        pythonPath = p;
        break;
      }
    }

    // Build script path
    const scriptPath = path.join(__dirname, 'transcribe.py');

    // Build arguments
    const args = [scriptPath, audioPath, method];
    if (method === 'openai' && apiKey) {
      args.push(apiKey);
    }

    const python = spawn(pythonPath, args);

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (e) {
          resolve({ success: false, error: `Failed to parse result: ${stdout}` });
        }
      } else {
        resolve({ success: false, error: stderr || `Python exited with code ${code}` });
      }
    });

    python.on('error', (err) => {
      resolve({ success: false, error: `Failed to start Python: ${err.message}` });
    });
  });
});

// Check if Python and Whisper are available for local transcription
ipcMain.handle('check-local-whisper', async () => {
  const { spawn } = require('child_process');

  return new Promise((resolve) => {
    // Find Python path
    const pythonPaths = [
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      '/usr/bin/python3',
      'python3',
      'python'
    ];

    let pythonPath = null;
    for (const p of pythonPaths) {
      if (fs.existsSync(p)) {
        pythonPath = p;
        break;
      }
    }

    if (!pythonPath) {
      return resolve({
        available: false,
        error: 'Python not found. Install Python 3 to use local transcription.'
      });
    }

    // Check if whisper module is installed
    const python = spawn(pythonPath, ['-c', 'import whisper; print("ok")']);

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code === 0 && stdout.trim() === 'ok') {
        resolve({ available: true });
      } else {
        resolve({
          available: false,
          error: 'Whisper not installed. Run: pip install openai-whisper'
        });
      }
    });

    python.on('error', () => {
      resolve({
        available: false,
        error: 'Python not found. Install Python 3 to use local transcription.'
      });
    });
  });
});

// ===== Streaming Recording for Long Meetings =====
// These handlers support flushing audio data to disk periodically
// to prevent data loss if the app crashes during long recordings.
// Writes to temp folder during recording, then atomically moves to final location.
// This ensures file integrity - the final .webm only exists if recording completed successfully.

// Active recordings map: recordingId -> { fd, tempPath, finalPath, startTime }
const activeRecordings = new Map();

// Start a streaming recording - creates temp file in dedicated temp folder
ipcMain.handle('start-streaming-recording', async (event, { recordingId, filename }) => {
  initPaths();
  try {
    const tempPath = path.join(tempRecordingsDir, `${recordingId}.webm.tmp`);
    const recordingsDir = getRecordingsDir();
    const finalPath = path.join(recordingsDir, filename);
    
    const fd = fs.openSync(tempPath, 'w');
    activeRecordings.set(recordingId, {
      fd,
      tempPath,
      finalPath,
      startTime: Date.now()
    });
    console.log('Started streaming recording:', recordingId);
    return { success: true, tempPath, finalPath };
  } catch (error) {
    console.error('Error starting streaming recording:', error);
    return { success: false, error: error.message };
  }
});

// Append audio chunk to temp file
ipcMain.handle('append-audio-chunk', async (event, { recordingId, chunk }) => {
  try {
    const recording = activeRecordings.get(recordingId);
    if (!recording) {
      return { success: false, error: 'Recording not found' };
    }
    
    // Write chunk to file
    const buffer = Buffer.from(chunk);
    fs.writeSync(recording.fd, buffer);
    
    return { success: true };
  } catch (error) {
    console.error('Error appending audio chunk:', error);
    return { success: false, error: error.message };
  }
});

// Flush (sync) the temp file to ensure data is written to disk
ipcMain.handle('flush-audio-file', async (event, recordingId) => {
  try {
    const recording = activeRecordings.get(recordingId);
    if (!recording) {
      return { success: false, error: 'Recording not found' };
    }
    
    fs.fsyncSync(recording.fd);
    
    return { success: true };
  } catch (error) {
    console.error('Error flushing audio file:', error);
    return { success: false, error: error.message };
  }
});

// Finalize recording - close temp file and atomically move to final location
ipcMain.handle('finalize-recording', async (event, { recordingId }) => {
  try {
    const recording = activeRecordings.get(recordingId);
    if (!recording) {
      return { success: false, error: 'Recording not found' };
    }
    
    // Close file descriptor
    fs.closeSync(recording.fd);
    
    // Atomic move: temp file only appears in recordings folder when complete
    fs.renameSync(recording.tempPath, recording.finalPath);
    
    // Remove from active recordings
    activeRecordings.delete(recordingId);
    
    console.log('Finalized recording:', recording.finalPath);
    return { success: true, path: recording.finalPath };
  } catch (error) {
    console.error('Error finalizing recording:', error);
    return { success: false, error: error.message };
  }
});

// Cancel/abandon recording - delete temp file
ipcMain.handle('cancel-recording', async (event, recordingId) => {
  try {
    const recording = activeRecordings.get(recordingId);
    if (recording) {
      fs.closeSync(recording.fd);
      if (fs.existsSync(recording.tempPath)) {
        fs.unlinkSync(recording.tempPath);
      }
      activeRecordings.delete(recordingId);
    }
    return { success: true };
  } catch (error) {
    console.error('Error canceling recording:', error);
    return { success: false, error: error.message };
  }
});

// Check for incomplete recordings (for crash recovery)
ipcMain.handle('check-incomplete-recordings', async () => {
  initPaths();
  try {
    const files = fs.readdirSync(tempRecordingsDir);
    const incomplete = files
      .filter(f => f.endsWith('.webm.tmp'))
      .map(f => {
        const filePath = path.join(tempRecordingsDir, f);
        const stats = fs.statSync(filePath);
        return {
          recordingId: f.replace('.webm.tmp', ''),
          tempPath: filePath,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString()
        };
      });
    return { success: true, incomplete };
  } catch (error) {
    console.error('Error checking incomplete recordings:', error);
    return { success: false, error: error.message, incomplete: [] };
  }
});

// Recover incomplete recording - move temp file to final location
ipcMain.handle('recover-recording', async (event, { recordingId, filename }) => {
  initPaths();
  try {
    const tempPath = path.join(tempRecordingsDir, `${recordingId}.webm.tmp`);
    if (!fs.existsSync(tempPath)) {
      return { success: false, error: 'Temp file not found' };
    }
    
    const recordingsDir = getRecordingsDir();
    const finalPath = path.join(recordingsDir, filename);
    fs.renameSync(tempPath, finalPath);
    
    console.log('Recovered recording:', filename);
    return { success: true, path: finalPath };
  } catch (error) {
    console.error('Error recovering recording:', error);
    return { success: false, error: error.message };
  }
});

// Delete incomplete recording
ipcMain.handle('delete-incomplete-recording', async (event, recordingId) => {
  initPaths();
  try {
    const tempPath = path.join(tempRecordingsDir, `${recordingId}.webm.tmp`);
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    return { success: true };
  } catch (error) {
    console.error('Error deleting incomplete recording:', error);
    return { success: false, error: error.message };
  }
});
