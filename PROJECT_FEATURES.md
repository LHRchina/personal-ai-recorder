# Audio Recorder - Project Features & Architecture

> **Document Purpose**: This file tracks all features, bug fixes, and architectural decisions made to the Audio Recorder project. Future developers/agents should read this first before making changes.

---

## 1. Project Overview

An Electron-based macOS audio recorder for capturing meeting audio (Teams, Zoom, etc.) with transcription support.

**Tech Stack:**
- Electron (v28.0.0)
- Vanilla JavaScript (no frameworks)
- Web Audio API + MediaRecorder API
- FFmpeg for audio conversion
- OpenAI Whisper API or Local Whisper for transcription

---

## 2. Core Features

### 2.1 Audio Recording Modes

Three recording modes are supported:

| Mode | Description | Use Case |
|------|-------------|----------|
| **System Audio** | Records audio output from computer | Capture meeting participants |
| **Microphone** | Records from selected microphone | Record your voice only |
| **Both** | Mixes system audio + microphone | Record full meeting (recommended) |

**Implementation:** `src/renderer/app.js` - `startRecording()` method
- System Audio: Uses `navigator.mediaDevices.getDisplayMedia()` with audio
- Microphone: Uses `navigator.mediaDevices.getUserMedia()`
- Both: Creates AudioContext with ChannelMerger to mix both streams

### 2.2 Streaming Recording for Long Meetings

**Purpose:** Prevent data loss on crashes during long recordings

**Architecture:**
```
Recording Start → Create temp file in temp_recordings/ 
                    ↓
              Every 5 seconds: Append chunks to file
                    ↓
              Recording Stop → Atomic move to recordings/ folder
```

**Key Files:**
- `main.js`: IPC handlers for streaming (`start-streaming-recording`, `append-audio-chunk`, `finalize-recording`)
- `preload.js`: Exposes streaming APIs to renderer
- `app.js`: `flushChunksToDisk()`, `finalizeStreamingRecording()`

**Flush Strategy:**
- Buffer audio chunks in memory
- Flush to disk every 5 seconds (`FLUSH_INTERVAL_MS = 5000`)
- Force fsync every 30 seconds for durability

**Why Temp File → Final File:**
- Atomic move ensures file integrity
- WebM headers are written correctly only on complete recording
- Partial recordings don't appear in user's folder

### 2.3 Crash Recovery

**On app startup:** `checkForIncompleteRecordings()`
1. Check `temp_recordings/` folder for `.webm.tmp` files
2. Show dialog: "Found incomplete recording from [date] (XX MB)"
3. User chooses: Recover → Save as `recovered-[timestamp].webm` OR Delete

---

## 3. Transcription System

### 3.1 Dual Mode Support

| Mode | Requirements | Fallback Behavior |
|------|--------------|-------------------|
| **OpenAI API** | API key in localStorage | Auto-fallback to Local if no key |
| **Local Whisper** | Python + openai-whisper package | Show error if not installed |

**Auto-Fallback Logic:**
```javascript
if (method === 'openai' && !hasApiKey()) {
    const localCheck = await checkLocalWhisper();
    if (localCheck.available) {
        method = 'local';  // Auto-fallback
    } else {
        throw error;  // Ask user to add API key or install Whisper
    }
}
```

### 3.2 API Key Storage

- **Location:** `localStorage.getItem('openai_api_key')`
- **File on disk:** `~/Library/Application Support/audio-recorder/Local Storage/leveldb/`
- **Security:** Not encrypted (plain text in localStorage)
- **Optional:** User can use Local Whisper without API key

**To retrieve existing key:**
```bash
strings ~/Library/Application\ Support/audio-recorder/Local\ Storage/leveldb/000003.log | grep -A1 openai_api_key
```

---

## 4. UI/UX Features

### 4.1 Recording Controls

| Button | Action |
|--------|--------|
| 🔴 Record | Start recording (toggles to Stop during recording) |
| ⏸️ Pause | Pause/resume current recording |
| ⏹️ Stop | Stop and save recording |

### 4.2 Source Toggle Buttons

Three buttons in `index.html`:
```html
<button id="systemAudioBtn" data-source="system">System Audio</button>
<button id="bothAudioBtn" data-source="both">Both</button>
<button id="microphoneBtn" data-source="microphone">Microphone</button>
```

**Behavior:**
- Only selectable when NOT recording
- Shows/hides device selector and info messages accordingly
- "Both" mode shows microphone selector + info about capturing both sources

### 4.3 Settings Modal

**Access:** Gear icon (⚙️) in title bar

**Settings:**
- OpenAI API Key input (password field, shows `••••`)
- Transcription Method toggle (Local / OpenAI)
- Storage Location (custom folder path)

**Important CSS Fix:**
Settings button needs `-webkit-app-region: no-drag` to be clickable in draggable title bar.

### 4.4 Recording List

Each recording item shows:
- Play/Pause button
- Recording name (formatted from timestamp)
- Date and file size
- Convert to MP3 button (for .webm files)
- Transcribe button
- Delete button

---

## 5. Bug Fixes & Solutions

### 5.1 Settings Button Not Clickable

**Problem:** Title bar has `-webkit-app-region: drag`, making entire area draggable

**Fix:** Add to `.settings-btn` in `styles.css`:
```css
.settings-btn {
  -webkit-app-region: no-drag;  /* Critical! */
  ...
}
```

### 5.2 Recording Only Captured Others, Not Self

**Problem:** System Audio mode didn't capture user's microphone

**Fix:** Added "Both" mode that uses AudioContext + ChannelMerger:
```javascript
const merger = this.audioContext.createChannelMerger(2);
displaySource.connect(merger, 0, 0);  // System audio
micSource.connect(merger, 0, 1);      // Microphone
```

### 5.3 Long Meeting Data Loss

**Problem:** Recording held entirely in memory, lost on crash

**Fix:** Implemented streaming recording with periodic disk flush (Section 2.2)

---

## 6. File Locations

### User Data
```
~/Library/Application Support/audio-recorder/
├── recordings/           # Final recordings (.webm, .mp3)
├── temp_recordings/      # Active recordings (.webm.tmp)
├── settings.json         # User preferences
└── Local Storage/        # localStorage (API key, etc.)
```

### Project Structure
```
recorder/
├── main.js               # Electron main process, IPC handlers
├── preload.js            # Context bridge, API exposure
├── package.json          # Dependencies
├── ffmpeg                # Bundled binary
├── src/renderer/
│   ├── index.html        # Main UI
│   ├── app.js            # Main application logic
│   ├── styles.css        # Styling
│   ├── transcription.js  # Transcription service
│   └── transcription-worker.js
└── PROJECT_FEATURES.md   # This file
```

---

## 7. Key Implementation Details

### 7.1 MediaRecorder Configuration
```javascript
this.mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'audio/webm;codecs=opus'
});
this.mediaRecorder.start(100);  // Collect data every 100ms
```

### 7.2 Audio Visualization
- Uses `AnalyserNode` with `fftSize = 256`
- Visualizes frequency data on canvas
- Only active during recording

### 7.3 FFmpeg Integration
- Used for converting WebM → MP3
- Searches for ffmpeg in multiple locations
- Spawns as child process

### 7.4 Transcription Flow
1. Convert WebM to MP3 (if needed)
2. Send to Python script (`transcribe.py`)
3. Python script handles OpenAI API or local Whisper
4. Returns JSON with transcribed text

---

## 8. Future Enhancement Ideas

1. **Encrypted API key storage** - Use macOS Keychain instead of localStorage
2. **Real-time transcription** - Stream audio chunks to Whisper during recording
3. **Auto-recovery without dialog** - Silent recovery of temp files on startup
4. **Recording scheduler** - Start/stop recording at specific times
5. **Multiple audio tracks** - Save system audio and mic as separate tracks

---

## 9. Quick Commands for Debugging

```bash
# Find recordings
open ~/Library/Application\ Support/audio-recorder/recordings/

# Check temp files (incomplete recordings)
ls -la ~/Library/Application\ Support/audio-recorder/temp_recordings/

# View localStorage
cat ~/Library/Application\ Support/audio-recorder/Local\ Storage/leveldb/000003.log | strings

# Check settings
cat ~/Library/Application\ Support/audio-recorder/settings.json

# Test local whisper
python3 -c "import whisper; print('Whisper OK')"
```

---

**Last Updated:** 2026-01-30
**Maintained by:** AI Development Team
