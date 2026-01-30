// ===== Audio Recorder Application =====

class AudioRecorder {
    constructor() {
        // State
        this.isRecording = false;
        this.isPaused = false;
        this.sourceType = 'system'; // 'system' or 'microphone'
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.startTime = null;
        this.pausedTime = 0;
        this.timerInterval = null;
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.animationId = null;
        this.currentAudio = null;
        this.currentPlayingItem = null;

        // Streaming recording properties (for long meetings)
        this.recordingId = null;
        this.chunkBuffer = [];
        this.flushInterval = null;
        this.lastFlushTime = 0;
        this.FLUSH_INTERVAL_MS = 5000; // Flush to disk every 5 seconds

        // DOM Elements
        this.recordBtn = document.getElementById('recordBtn');
        this.pauseBtn = document.getElementById('pauseBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.timerDisplay = document.getElementById('timerDisplay');
        this.recordingIndicator = document.getElementById('recordingIndicator');
        this.audioDeviceSelect = document.getElementById('audioDevice');
        this.deviceLabel = document.getElementById('deviceLabel');
        this.recordingsList = document.getElementById('recordingsList');
        this.openFolderBtn = document.getElementById('openFolderBtn');
        this.waveformCanvas = document.getElementById('waveform');
        this.canvasCtx = this.waveformCanvas.getContext('2d');
        this.pauseIcon = document.getElementById('pauseIcon');
        this.resumeIcon = document.getElementById('resumeIcon');
        this.systemAudioBtn = document.getElementById('systemAudioBtn');
        this.microphoneBtn = document.getElementById('microphoneBtn');
        this.bothAudioBtn = document.getElementById('bothAudioBtn');

        // Setup help modal
        this.setupHelpModal = document.getElementById('setupHelpModal');
        this.closeSetupHelpBtn = document.getElementById('closeSetupHelpBtn');
        this.closeSetupHelpBtn2 = document.getElementById('closeSetupHelpBtn2');
        this.hasVirtualAudioDevice = false;

        // Initialize
        this.init();
    }

    async init() {
        this.bindEvents();
        this.bindSetupHelpEvents();
        // Show system audio info by default (since system is the default mode)
        const systemAudioInfo = document.getElementById('systemAudioInfo');
        const deviceSelector = document.querySelector('.device-selector');
        if (systemAudioInfo) systemAudioInfo.classList.add('visible');
        if (deviceSelector) deviceSelector.style.display = 'none';
        await this.loadRecordings();
        this.drawIdleWaveform();
        
        // Check for incomplete recordings (crash recovery)
        await this.checkForIncompleteRecordings();
    }

    async checkForIncompleteRecordings() {
        try {
            const result = await window.electronAPI.checkIncompleteRecordings();
            if (result.success && result.incomplete.length > 0) {
                console.log('Found incomplete recordings:', result.incomplete);
                
                for (const recording of result.incomplete) {
                    const sizeMB = (recording.size / (1024 * 1024)).toFixed(1);
                    const date = new Date(recording.modifiedAt).toLocaleString();
                    
                    const shouldRecover = confirm(
                        `Found an incomplete recording from ${date} (${sizeMB} MB).\n\n` +
                        `This may be from a previous crash or force quit.\n\n` +
                        `Would you like to recover this recording?\n\n` +
                        `Click OK to save it, or Cancel to delete it.`
                    );
                    
                    if (shouldRecover) {
                        // Generate filename based on the recording time
                        const timestamp = new Date(recording.modifiedAt).toISOString()
                            .replace(/[:.]/g, '-')
                            .slice(0, 19);
                        const filename = `recovered-${timestamp}.webm`;
                        
                        const recoverResult = await window.electronAPI.recoverRecording(
                            recording.recordingId, 
                            filename
                        );
                        
                        if (recoverResult.success) {
                            console.log('Recovered recording:', recoverResult.path);
                        } else {
                            alert('Failed to recover recording: ' + recoverResult.error);
                        }
                    } else {
                        // Delete the incomplete recording
                        await window.electronAPI.deleteIncompleteRecording(recording.recordingId);
                    }
                }
                
                // Reload recordings if any were recovered
                await this.loadRecordings();
            }
        } catch (error) {
            console.error('Error checking for incomplete recordings:', error);
        }
    }

    bindEvents() {
        this.recordBtn.addEventListener('click', () => this.toggleRecording());
        this.pauseBtn.addEventListener('click', () => this.togglePause());
        this.stopBtn.addEventListener('click', () => this.stopRecording());
        this.openFolderBtn.addEventListener('click', () => this.openRecordingsFolder());
        this.audioDeviceSelect.addEventListener('change', () => this.onDeviceChange());

        // Source toggle events
        this.systemAudioBtn.addEventListener('click', () => this.setSourceType('system'));
        this.microphoneBtn.addEventListener('click', () => this.setSourceType('microphone'));
        this.bothAudioBtn.addEventListener('click', () => this.setSourceType('both'));
    }

    bindSetupHelpEvents() {
        // Close button handlers
        this.closeSetupHelpBtn?.addEventListener('click', () => this.closeSetupHelpModal());
        this.closeSetupHelpBtn2?.addEventListener('click', () => this.closeSetupHelpModal());

        // Close on overlay click
        this.setupHelpModal?.addEventListener('click', (e) => {
            if (e.target === this.setupHelpModal) {
                this.closeSetupHelpModal();
            }
        });

        // Setup help trigger button
        const showSetupHelpBtn = document.getElementById('showSetupHelpBtn');
        showSetupHelpBtn?.addEventListener('click', () => this.openSetupHelpModal());

        // Copy code button
        document.querySelectorAll('.copy-code-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const code = btn.dataset.code;
                navigator.clipboard.writeText(code);
                btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                setTimeout(() => {
                    btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
                }, 2000);
            });
        });
    }

    openSetupHelpModal() {
        this.setupHelpModal?.classList.add('active');
    }

    closeSetupHelpModal() {
        this.setupHelpModal?.classList.remove('active');
    }

    setSourceType(type) {
        if (this.isRecording) return; // Don't change during recording

        this.sourceType = type;
        const deviceSelector = document.querySelector('.device-selector');
        const systemAudioInfo = document.getElementById('systemAudioInfo');

        // Update button states
        this.systemAudioBtn.classList.remove('active');
        this.microphoneBtn.classList.remove('active');
        this.bothAudioBtn.classList.remove('active');

        if (type === 'system') {
            this.systemAudioBtn.classList.add('active');
            // Hide device selector for system audio - we use screen sharing instead
            if (deviceSelector) {
                deviceSelector.style.display = 'none';
            }
            // Show system audio info
            if (systemAudioInfo) {
                systemAudioInfo.classList.add('visible');
                systemAudioInfo.querySelector('span').innerHTML = 'Captures others in the meeting. <strong>Your voice will NOT be recorded.</strong>';
            }
        } else if (type === 'microphone') {
            this.microphoneBtn.classList.add('active');
            this.deviceLabel.textContent = 'Microphone';
            // Show device selector for microphone
            if (deviceSelector) {
                deviceSelector.style.display = 'block';
            }
            // Hide system audio info
            if (systemAudioInfo) {
                systemAudioInfo.classList.remove('visible');
            }
            // Reload devices for the selected source type
            this.loadAudioDevices();
        } else if (type === 'both') {
            this.bothAudioBtn.classList.add('active');
            this.deviceLabel.textContent = 'Microphone (for your voice)';
            // Show device selector for microphone selection
            if (deviceSelector) {
                deviceSelector.style.display = 'block';
            }
            // Show system audio info with updated message
            if (systemAudioInfo) {
                systemAudioInfo.classList.add('visible');
                systemAudioInfo.querySelector('span').innerHTML = 'Captures <strong>both</strong> system audio (others) AND your microphone. Perfect for meetings!';
            }
            // Reload devices for microphone selection
            this.loadAudioDevices();
        }
    }

    async loadAudioDevices() {
        try {
            // Request permission first
            await navigator.mediaDevices.getUserMedia({ audio: true });

            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');

            this.audioDeviceSelect.innerHTML = '';

            if (audioInputs.length === 0) {
                this.audioDeviceSelect.innerHTML = '<option value="">No audio devices found</option>';
                return;
            }

            // Filter and categorize devices based on source type
            const isSystemAudio = this.sourceType === 'system';
            let hasSelectedDevice = false;
            let foundVirtualDevice = false;

            audioInputs.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                const label = device.label || `Audio Input ${index + 1}`;

                const isVirtualDevice = label.toLowerCase().includes('blackhole') ||
                    label.toLowerCase().includes('soundflower') ||
                    label.toLowerCase().includes('loopback') ||
                    label.toLowerCase().includes('virtual');

                if (isVirtualDevice) {
                    foundVirtualDevice = true;
                }

                if (isSystemAudio) {
                    // For system audio, prioritize virtual audio devices
                    if (isVirtualDevice) {
                        option.textContent = `🎵 ${label}`;
                        if (!hasSelectedDevice) {
                            option.selected = true;
                            hasSelectedDevice = true;
                        }
                    } else {
                        option.textContent = label;
                    }
                } else {
                    // For microphone, prioritize physical microphones
                    if (isVirtualDevice) {
                        option.textContent = `🔇 ${label} (Virtual)`;
                    } else {
                        option.textContent = `🎤 ${label}`;
                        if (!hasSelectedDevice) {
                            option.selected = true;
                            hasSelectedDevice = true;
                        }
                    }
                }

                this.audioDeviceSelect.appendChild(option);
            });

            // Track if virtual audio device exists
            this.hasVirtualAudioDevice = foundVirtualDevice;

            // Show help modal if switching to system audio without virtual device
            if (isSystemAudio && !foundVirtualDevice) {
                this.openSetupHelpModal();
            }
        } catch (error) {
            console.error('Error loading audio devices:', error);
            this.audioDeviceSelect.innerHTML = '<option value="">Permission denied</option>';
        }
    }

    onDeviceChange() {
        // Just log for now, device will be used when recording starts
        console.log('Selected device:', this.audioDeviceSelect.value);
    }

    async toggleRecording() {
        if (this.isRecording) {
            // If recording, clicking record again does nothing (use stop)
            return;
        }
        await this.startRecording();
    }

    async startRecording() {
        try {
            let stream;

            if (this.sourceType === 'system') {
                // Use screen capture with loopback audio
                // Electron's setDisplayMediaRequestHandler picks the source automatically
                try {
                    stream = await navigator.mediaDevices.getDisplayMedia({
                        video: true, // Required, but we'll stop it immediately
                        audio: true  // Request audio
                    });

                    // Stop video track immediately - we only need audio
                    stream.getVideoTracks().forEach(track => track.stop());

                    // Check if we got audio
                    const audioTracks = stream.getAudioTracks();
                    if (audioTracks.length === 0) {
                        throw new Error('No audio track available. System audio capture requires Screen Recording permission.');
                    }

                    console.log('Got audio tracks:', audioTracks.length, audioTracks[0]?.label);
                } catch (displayError) {
                    console.error('Display media error:', displayError);
                    if (displayError.name === 'NotAllowedError') {
                        alert('Screen recording permission required. Please grant permission in System Preferences > Privacy > Screen Recording.');
                        return;
                    }
                    throw displayError;
                }
            } else if (this.sourceType === 'both') {
                // Mix both system audio and microphone
                try {
                    // Get system audio via display media
                    const displayStream = await navigator.mediaDevices.getDisplayMedia({
                        video: true,
                        audio: true
                    });
                    displayStream.getVideoTracks().forEach(track => track.stop());

                    const displayAudioTracks = displayStream.getAudioTracks();
                    if (displayAudioTracks.length === 0) {
                        throw new Error('No system audio track available. Please make sure to check "Share audio" when selecting the source.');
                    }

                    // Get microphone audio
                    const micConstraints = {
                        audio: {
                            deviceId: this.audioDeviceSelect.value ?
                                { exact: this.audioDeviceSelect.value } : undefined,
                            echoCancellation: false,
                            noiseSuppression: false,
                            autoGainControl: false
                        }
                    };
                    const micStream = await navigator.mediaDevices.getUserMedia(micConstraints);

                    // Create audio context to mix both streams
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    
                    // Create sources from both streams
                    const displaySource = this.audioContext.createMediaStreamSource(displayStream);
                    const micSource = this.audioContext.createMediaStreamSource(micStream);
                    
                    // Create a merger to combine both sources
                    const merger = this.audioContext.createChannelMerger(2);
                    displaySource.connect(merger, 0, 0);
                    micSource.connect(merger, 0, 1);
                    
                    // Create a destination to get the mixed stream
                    const destination = this.audioContext.createMediaStreamDestination();
                    merger.connect(destination);
                    
                    // The mixed stream
                    stream = destination.stream;
                    
                    // Keep references to stop tracks later
                    this.displayStream = displayStream;
                    this.micStream = micStream;
                    
                    // Setup analyser for visualization (connect the merger to analyser)
                    this.analyser = this.audioContext.createAnalyser();
                    this.analyser.fftSize = 256;
                    merger.connect(this.analyser);
                    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
                    
                    console.log('Mixed system audio and microphone');
                } catch (bothError) {
                    console.error('Mixed recording error:', bothError);
                    if (bothError.name === 'NotAllowedError') {
                        alert('Permission required. Please grant screen recording and microphone permissions.');
                        return;
                    }
                    throw bothError;
                }
            } else {
                // Use microphone for voice recording
                const constraints = {
                    audio: {
                        deviceId: this.audioDeviceSelect.value ?
                            { exact: this.audioDeviceSelect.value } : undefined,
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false
                    }
                };
                stream = await navigator.mediaDevices.getUserMedia(constraints);
            }

            // Setup audio context for visualization (if not already done for 'both' mode)
            if (this.sourceType !== 'both') {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const source = this.audioContext.createMediaStreamSource(stream);
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = 256;
                source.connect(this.analyser);
                this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            }

            // Setup MediaRecorder
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            // Initialize streaming recording for long meetings
            this.recordingId = `rec-${Date.now()}`;
            this.chunkBuffer = [];
            this.lastFlushTime = Date.now();
            
            // Generate filename at the start (used for direct file writing)
            const timestamp = new Date().toISOString()
                .replace(/[:.]/g, '-')
                .slice(0, 19);
            this.currentFilename = `recording-${timestamp}.webm`;
            
            // Start streaming to disk (writes directly to recordings folder with .partial extension)
            const streamResult = await window.electronAPI.startStreamingRecording(
                this.recordingId, 
                this.currentFilename
            );
            if (!streamResult.success) {
                throw new Error('Failed to start streaming recording: ' + streamResult.error);
            }
            console.log('Streaming recording started:', this.recordingId, '->', this.currentFilename);

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.chunkBuffer.push(event.data);
                    
                    // Flush to disk periodically
                    const now = Date.now();
                    if (now - this.lastFlushTime > this.FLUSH_INTERVAL_MS) {
                        this.flushChunksToDisk();
                    }
                }
            };

            this.mediaRecorder.onstop = () => {
                this.finalizeStreamingRecording();
            };

            this.mediaRecorder.start(100); // Collect data every 100ms
            this.isRecording = true;
            this.isPaused = false;
            this.startTime = Date.now();
            this.pausedTime = 0;

            // Update UI
            this.recordBtn.classList.add('recording');
            this.pauseBtn.disabled = false;
            this.stopBtn.disabled = false;
            this.recordingIndicator.classList.add('active');

            // Start timer and visualization
            this.startTimer();
            this.drawWaveform();

        } catch (error) {
            console.error('Error starting recording:', error);
            if (this.sourceType === 'system') {
                alert('Could not capture system audio. Please try again and make sure to check "Share audio" when selecting the source.');
            } else if (this.sourceType === 'both') {
                alert('Could not capture both audio sources. Please check screen recording and microphone permissions.');
            } else {
                alert('Could not access microphone. Please check permissions.');
            }
        }
    }

    togglePause() {
        if (!this.isRecording) return;

        if (this.isPaused) {
            // Resume
            this.mediaRecorder.resume();
            this.isPaused = false;
            this.startTime = Date.now() - this.pausedTime;
            this.startTimer();
            this.drawWaveform();
            this.pauseIcon.classList.remove('hidden');
            this.resumeIcon.classList.add('hidden');
            this.recordingIndicator.classList.add('active');
        } else {
            // Pause
            this.mediaRecorder.pause();
            this.isPaused = true;
            this.pausedTime = Date.now() - this.startTime;
            clearInterval(this.timerInterval);
            cancelAnimationFrame(this.animationId);
            this.pauseIcon.classList.add('hidden');
            this.resumeIcon.classList.remove('hidden');
            this.recordingIndicator.classList.remove('active');
        }
    }

    async flushChunksToDisk() {
        if (this.chunkBuffer.length === 0 || !this.recordingId) return;
        
        try {
            // Convert all buffered chunks to a single array buffer
            const blobs = new Blob(this.chunkBuffer);
            const arrayBuffer = await blobs.arrayBuffer();
            
            // Send to main process to append to file
            const result = await window.electronAPI.appendAudioChunk(
                this.recordingId, 
                arrayBuffer
            );
            
            if (result.success) {
                // Clear buffer after successful write
                this.chunkBuffer = [];
                this.lastFlushTime = Date.now();
                
                // Also flush to disk (fsync) every 30 seconds for extra safety
                if (this.lastFlushTime % 30000 < this.FLUSH_INTERVAL_MS) {
                    await window.electronAPI.flushAudioFile(this.recordingId);
                }
            }
        } catch (error) {
            console.error('Error flushing chunks to disk:', error);
            // Don't throw - we'll try again on next interval
        }
    }

    async finalizeStreamingRecording() {
        try {
            // Flush any remaining chunks
            if (this.chunkBuffer.length > 0) {
                const blobs = new Blob(this.chunkBuffer);
                const arrayBuffer = await blobs.arrayBuffer();
                await window.electronAPI.appendAudioChunk(this.recordingId, arrayBuffer);
                this.chunkBuffer = [];
            }
            
            // Finalize the recording (rename .partial to .webm)
            // Filename was set when recording started
            const result = await window.electronAPI.finalizeRecording(this.recordingId);
            
            if (result.success) {
                console.log('Recording finalized:', result.path);
                await this.loadRecordings();
            } else {
                console.error('Failed to finalize recording:', result.error);
                alert('Failed to save recording: ' + result.error);
            }
        } catch (error) {
            console.error('Error finalizing recording:', error);
            alert('Error saving recording: ' + error.message);
        } finally {
            // Reset recording state
            this.recordingId = null;
            this.currentFilename = null;
            this.chunkBuffer = [];
        }
    }

    stopRecording() {
        if (!this.isRecording) return;

        this.mediaRecorder.stop();
        this.mediaRecorder.stream.getTracks().forEach(track => track.stop());

        this.isRecording = false;
        this.isPaused = false;

        // Cleanup audio context
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        // Cleanup mixed streams if in 'both' mode
        if (this.displayStream) {
            this.displayStream.getTracks().forEach(track => track.stop());
            this.displayStream = null;
        }
        if (this.micStream) {
            this.micStream.getTracks().forEach(track => track.stop());
            this.micStream = null;
        }

        // Reset UI
        this.recordBtn.classList.remove('recording');
        this.pauseBtn.disabled = true;
        this.stopBtn.disabled = true;
        this.pauseIcon.classList.remove('hidden');
        this.resumeIcon.classList.add('hidden');
        this.recordingIndicator.classList.remove('active');

        // Stop timer and animation
        clearInterval(this.timerInterval);
        cancelAnimationFrame(this.animationId);
        this.timerDisplay.textContent = '00:00:00';
        this.drawIdleWaveform();
    }

    async saveRecording() {
        const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();

        const timestamp = new Date().toISOString()
            .replace(/[:.]/g, '-')
            .slice(0, 19);
        const filename = `recording-${timestamp}.webm`;

        const result = await window.electronAPI.saveRecording(arrayBuffer, filename);

        if (result.success) {
            await this.loadRecordings();
        } else {
            console.error('Failed to save recording:', result.error);
        }
    }

    startTimer() {
        this.timerInterval = setInterval(() => {
            const elapsed = Date.now() - this.startTime;
            this.timerDisplay.textContent = this.formatTime(elapsed);
        }, 100);
    }

    formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    drawWaveform() {
        if (!this.isRecording || this.isPaused) return;

        this.analyser.getByteFrequencyData(this.dataArray);

        const canvas = this.waveformCanvas;
        const ctx = this.canvasCtx;
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.fillStyle = 'rgba(10, 10, 15, 0.3)';
        ctx.fillRect(0, 0, width, height);

        // Draw bars
        const barCount = 50;
        const barWidth = width / barCount - 2;
        const gradient = ctx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, '#ff3b5c');
        gradient.addColorStop(0.5, '#ff6b8a');
        gradient.addColorStop(1, '#8b5cf6');

        for (let i = 0; i < barCount; i++) {
            const dataIndex = Math.floor(i * this.dataArray.length / barCount);
            const value = this.dataArray[dataIndex];
            const barHeight = (value / 255) * (height * 0.8);

            const x = i * (barWidth + 2) + 1;
            const y = (height - barHeight) / 2;

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, barHeight, 2);
            ctx.fill();
        }

        this.animationId = requestAnimationFrame(() => this.drawWaveform());
    }

    drawIdleWaveform() {
        const canvas = this.waveformCanvas;
        const ctx = this.canvasCtx;
        const width = canvas.width;
        const height = canvas.height;

        ctx.fillStyle = 'rgba(10, 10, 15, 1)';
        ctx.fillRect(0, 0, width, height);

        // Draw small idle bars
        const barCount = 50;
        const barWidth = width / barCount - 2;

        for (let i = 0; i < barCount; i++) {
            const barHeight = 4 + Math.sin(i * 0.3) * 2;
            const x = i * (barWidth + 2) + 1;
            const y = (height - barHeight) / 2;

            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, barHeight, 1);
            ctx.fill();
        }
    }

    async loadRecordings() {
        const recordings = await window.electronAPI.getRecordings();

        if (recordings.length === 0) {
            this.recordingsList.innerHTML = `
        <div class="empty-state">
          <svg class="empty-icon" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>No recordings yet</p>
          <span>Click the red button to start recording</span>
        </div>
      `;
            return;
        }

        this.recordingsList.innerHTML = recordings.map(rec => `
      <div class="recording-item" data-path="${rec.path}" data-name="${rec.name}">
        <button class="play-btn">
          <svg class="play-icon" viewBox="0 0 24 24">
            <polygon points="5,3 19,12 5,21"></polygon>
          </svg>
          <svg class="pause-icon" viewBox="0 0 24 24" style="display:none;">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
        </button>
        <div class="recording-info">
          <div class="recording-name">${this.formatRecordingName(rec.name)}</div>
          <div class="recording-meta">
            <span>${this.formatDate(rec.createdAt)}</span>
            <span>•</span>
            <span>${this.formatFileSize(rec.size)}</span>
          </div>
        </div>
        ${rec.name.endsWith('.webm') ? `
        <button class="convert-btn" title="Convert to MP3">
          <svg viewBox="0 0 24 24">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
        </button>
        ` : ''}
        <button class="transcribe-btn" title="Transcribe to text">
          <svg viewBox="0 0 24 24">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
        </button>
        <button class="delete-btn" title="Delete recording">
          <svg viewBox="0 0 24 24">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"></path>
          </svg>
        </button>
      </div>
    `).join('');

        // Bind events to recording items
        this.recordingsList.querySelectorAll('.recording-item').forEach(item => {
            const playBtn = item.querySelector('.play-btn');
            const convertBtn = item.querySelector('.convert-btn');
            const transcribeBtn = item.querySelector('.transcribe-btn');
            const deleteBtn = item.querySelector('.delete-btn');

            playBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.playRecording(item);
            });

            if (convertBtn) {
                convertBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.convertToMp3(item.dataset.path, convertBtn);
                });
            }

            transcribeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.transcribeRecording(item.dataset.path, item.dataset.name);
            });

            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteRecording(item.dataset.name);
            });

            item.addEventListener('click', () => {
                this.playRecording(item);
            });
        });
    }

    formatRecordingName(name) {
        // Convert recording-2024-01-28T10-30-00.webm to readable format
        const match = name.match(/recording-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
        if (match) {
            const [, year, month, day, hour, min] = match;
            return `Recording ${month}/${day}/${year} ${hour}:${min}`;
        }
        return name;
    }

    formatDate(isoString) {
        const date = new Date(isoString);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

        return date.toLocaleDateString();
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    playRecording(item) {
        const path = item.dataset.path;
        const playIcon = item.querySelector('.play-icon');
        const pauseIcon = item.querySelector('.pause-icon');

        // If same item is playing, toggle pause
        if (this.currentPlayingItem === item && this.currentAudio) {
            if (this.currentAudio.paused) {
                this.currentAudio.play();
                playIcon.style.display = 'none';
                pauseIcon.style.display = 'block';
            } else {
                this.currentAudio.pause();
                playIcon.style.display = 'block';
                pauseIcon.style.display = 'none';
            }
            return;
        }

        // Stop current audio if playing
        if (this.currentAudio) {
            this.currentAudio.pause();
            if (this.currentPlayingItem) {
                this.currentPlayingItem.classList.remove('playing');
                const prevPlayIcon = this.currentPlayingItem.querySelector('.play-icon');
                const prevPauseIcon = this.currentPlayingItem.querySelector('.pause-icon');
                prevPlayIcon.style.display = 'block';
                prevPauseIcon.style.display = 'none';
            }
        }

        // Play new audio
        // Note: Audio is independent of recording - both can work simultaneously
        this.currentAudio = new Audio(`file://${path}`);
        this.currentAudio.volume = 1.0;
        
        // Ensure audio doesn't interfere with recording
        // by using a separate audio context if needed
        this.currentPlayingItem = item;
        item.classList.add('playing');
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';

        this.currentAudio.play().catch(err => {
            console.error('Error playing audio:', err);
            // If playback fails during recording, show helpful message
            if (this.isRecording) {
                console.log('Playback during recording may be limited due to audio focus');
            }
        });

        this.currentAudio.onended = () => {
            item.classList.remove('playing');
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
            this.currentAudio = null;
            this.currentPlayingItem = null;
        };
        
        this.currentAudio.onerror = (e) => {
            console.error('Audio playback error:', e);
            item.classList.remove('playing');
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
            this.currentAudio = null;
            this.currentPlayingItem = null;
        };
    }

    async deleteRecording(filename) {
        if (!confirm('Delete this recording?')) return;

        const result = await window.electronAPI.deleteRecording(filename);
        if (result.success) {
            await this.loadRecordings();
        }
    }

    async openRecordingsFolder() {
        const path = await window.electronAPI.getRecordingsPath();
        await window.electronAPI.showInFinder(path);
    }

    async convertToMp3(filePath, button) {
        if (!filePath.endsWith('.webm')) return;

        // Show loading state
        const originalHTML = button.innerHTML;
        button.innerHTML = '<svg class="spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="31.4 31.4"></circle></svg>';
        button.disabled = true;

        try {
            const result = await window.electronAPI.convertToMp3(filePath);

            if (result.success) {
                // Show success
                button.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                button.classList.add('success');

                // Reload recordings to show new MP3
                await this.loadRecordings();
            } else {
                // Show error
                button.innerHTML = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                button.classList.add('error');
                console.error('Conversion failed:', result.error);
                alert('Conversion failed: ' + result.error);

                setTimeout(() => {
                    button.innerHTML = originalHTML;
                    button.classList.remove('error');
                    button.disabled = false;
                }, 2000);
            }
        } catch (error) {
            console.error('Conversion error:', error);
            button.innerHTML = originalHTML;
            button.disabled = false;
            alert('Conversion error: ' + error.message);
        }
    }

    // ===== Transcription Methods =====

    initTranscription() {
        this.transcriptionModal = document.getElementById('transcriptionModal');
        this.transcriptionStatus = document.getElementById('transcriptionStatus');
        this.transcriptionText = document.getElementById('transcriptionText');
        this.closeTranscriptionBtn = document.getElementById('closeTranscriptionBtn');
        this.copyTranscriptionBtn = document.getElementById('copyTranscriptionBtn');
        this.saveTranscriptionBtn = document.getElementById('saveTranscriptionBtn');
        this.currentTranscriptionFile = null;

        // Bind modal events
        this.closeTranscriptionBtn.addEventListener('click', () => this.closeTranscriptionModal());
        this.copyTranscriptionBtn.addEventListener('click', () => this.copyTranscription());
        this.saveTranscriptionBtn.addEventListener('click', () => this.saveTranscription());

        // Close on overlay click
        this.transcriptionModal.addEventListener('click', (e) => {
            if (e.target === this.transcriptionModal) {
                this.closeTranscriptionModal();
            }
        });

        // Setup transcription service callbacks
        if (window.transcriptionService) {
            window.transcriptionService.onStatusChange = (status) => {
                this.updateTranscriptionStatus(status.status, status.message);
            };
            window.transcriptionService.onResult = (result) => {
                this.transcriptionText.value = result.text;
            };
            window.transcriptionService.onError = (error) => {
                this.updateTranscriptionStatus('error', error);
            };
        }
    }

    async transcribeRecording(filePath, fileName) {
        const method = window.transcriptionService?.getMethod() || 'openai';

        // Check if we need to show a warning about missing API key
        if (method === 'openai' && !window.transcriptionService?.hasApiKey()) {
            // Check if local whisper is available as fallback
            const localCheck = await window.electronAPI.checkLocalWhisper();
            if (!localCheck.available) {
                // No API key and no local whisper - show settings
                this.openSettingsModal();
                alert('Please configure your OpenAI API key in Settings, or install Local Whisper (pip install openai-whisper) to transcribe without an API key.');
                return;
            }
            // Local whisper is available, will auto-fallback
        }

        this.currentTranscriptionFile = fileName;
        this.transcriptionText.value = '';
        this.openTranscriptionModal();

        const methodLabel = method === 'local' ? 'Local Whisper' : 'OpenAI API';
        this.updateTranscriptionStatus('transcribing', `Transcribing with ${methodLabel}...`);

        try {
            const result = await window.transcriptionService.transcribeFromPath(filePath);
            this.transcriptionText.value = result.text;
            this.updateTranscriptionStatus('complete', `Transcription complete (${result.method || methodLabel})`);
        } catch (error) {
            console.error('Transcription error:', error);
            this.updateTranscriptionStatus('error', 'Transcription failed: ' + error.message);
        }
    }

    openTranscriptionModal() {
        this.transcriptionModal.classList.add('active');
    }

    closeTranscriptionModal() {
        this.transcriptionModal.classList.remove('active');
    }

    updateTranscriptionStatus(status, message) {
        const statusEl = this.transcriptionStatus;
        statusEl.className = 'transcription-status ' + status;

        const iconMap = {
            loading: '⏳',
            transcribing: '🎙️',
            complete: '✅',
            error: '❌',
            ready: '📝'
        };

        statusEl.querySelector('.status-icon').textContent = iconMap[status] || '📝';
        statusEl.querySelector('.status-text').textContent = message;
    }

    async copyTranscription() {
        const text = this.transcriptionText.value;
        if (!text) return;

        try {
            await navigator.clipboard.writeText(text);
            const btn = this.copyTranscriptionBtn;
            const originalText = btn.innerHTML;
            btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!';
            setTimeout(() => {
                btn.innerHTML = originalText;
            }, 2000);
        } catch (error) {
            console.error('Failed to copy:', error);
        }
    }

    async saveTranscription() {
        const text = this.transcriptionText.value;
        if (!text) return;

        const baseName = this.currentTranscriptionFile?.replace(/\.\w+$/, '') || 'transcription';
        const fileName = baseName + '.txt';

        // Save using Electron API
        const result = await window.electronAPI.saveRecording(
            new TextEncoder().encode(text),
            fileName
        );

        if (result.success) {
            const btn = this.saveTranscriptionBtn;
            const originalText = btn.innerHTML;
            btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Saved!';
            setTimeout(() => {
                btn.innerHTML = originalText;
            }, 2000);
        }
    }

    // ===== Settings Methods =====

    async initSettings() {
        this.settingsBtn = document.getElementById('settingsBtn');
        this.settingsModal = document.getElementById('settingsModal');
        this.closeSettingsBtn = document.getElementById('closeSettingsBtn');
        this.apiKeyInput = document.getElementById('apiKeyInput');
        this.saveSettingsBtn = document.getElementById('saveSettingsBtn');
        this.storagePathInput = document.getElementById('storagePathInput');
        this.browsePathBtn = document.getElementById('browsePathBtn');
        this.resetPathBtn = document.getElementById('resetPathBtn');
        this.localMethodBtn = document.getElementById('localMethodBtn');
        this.openaiMethodBtn = document.getElementById('openaiMethodBtn');

        // Check local Whisper availability
        this.localWhisperAvailable = false;
        this.localWhisperError = null;
        this.checkLocalWhisperAvailability();

        // Load existing API key
        if (window.transcriptionService?.hasApiKey()) {
            this.apiKeyInput.value = '••••••••••••••••';
            this.apiKeyInput.dataset.hasKey = 'true';
        } else {
            this.apiKeyInput.dataset.hasKey = 'false';
        }

        // Load current transcription method
        this.updateMethodToggle();

        // Load current storage path
        await this.loadStoragePath();

        // Bind events
        this.settingsBtn.addEventListener('click', () => this.openSettingsModal());
        this.closeSettingsBtn.addEventListener('click', () => this.closeSettingsModal());
        this.saveSettingsBtn.addEventListener('click', () => this.saveSettings());
        this.browsePathBtn.addEventListener('click', () => this.browseStoragePath());
        this.resetPathBtn.addEventListener('click', () => this.resetStoragePath());

        // Method toggle events
        this.localMethodBtn.addEventListener('click', () => this.setTranscriptionMethod('local'));
        this.openaiMethodBtn.addEventListener('click', () => this.setTranscriptionMethod('openai'));

        this.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.settingsModal) {
                this.closeSettingsModal();
            }
        });

        // Clear placeholder when focused
        this.apiKeyInput.addEventListener('focus', () => {
            if (this.apiKeyInput.value === '••••••••••••••••') {
                this.apiKeyInput.value = '';
            }
        });
    }

    async loadStoragePath() {
        const path = await window.electronAPI.getStoragePath();
        this.storagePathInput.value = path;
    }

    async openSettingsModal() {
        await this.loadStoragePath();
        this.settingsModal.classList.add('active');
        this.apiKeyInput.focus();
    }

    closeSettingsModal() {
        this.settingsModal.classList.remove('active');
    }

    async browseStoragePath() {
        const selectedPath = await window.electronAPI.selectFolder();
        if (selectedPath) {
            this.storagePathInput.value = selectedPath;
            const result = await window.electronAPI.setStoragePath(selectedPath);
            if (result.success) {
                await this.loadRecordings(); // Reload recordings from new path
            }
        }
    }

    async resetStoragePath() {
        const defaultPath = await window.electronAPI.resetStoragePath();
        this.storagePathInput.value = defaultPath;
        await this.loadRecordings(); // Reload recordings from default path
    }

    async checkLocalWhisperAvailability() {
        try {
            const result = await window.electronAPI.checkLocalWhisper();
            this.localWhisperAvailable = result.available;
            this.localWhisperError = result.error || null;

            // Update UI based on availability
            if (!this.localWhisperAvailable) {
                this.localMethodBtn.classList.add('disabled');
                this.localMethodBtn.title = this.localWhisperError;

                // If current method is local but unavailable, switch to OpenAI
                if (window.transcriptionService?.getMethod() === 'local') {
                    window.transcriptionService.setMethod('openai');
                    this.updateMethodToggle();
                }
            }
        } catch (error) {
            console.error('Failed to check local Whisper:', error);
            this.localWhisperAvailable = false;
        }
    }

    setTranscriptionMethod(method) {
        // Check if trying to use local but not available
        if (method === 'local' && !this.localWhisperAvailable) {
            alert(this.localWhisperError || 'Local Whisper is not available. Please install Python 3 and whisper package.');
            return;
        }

        window.transcriptionService.setMethod(method);
        this.updateMethodToggle();
    }

    updateMethodToggle() {
        const currentMethod = window.transcriptionService?.getMethod() || 'openai';

        if (currentMethod === 'local' && this.localWhisperAvailable) {
            this.localMethodBtn.classList.add('active');
            this.openaiMethodBtn.classList.remove('active');
        } else {
            this.localMethodBtn.classList.remove('active');
            this.openaiMethodBtn.classList.add('active');
        }
    }

    saveSettings() {
        const apiKey = this.apiKeyInput.value.trim();

        if (apiKey && apiKey !== '••••••••••••••••') {
            // Save new API key
            window.transcriptionService.setApiKey(apiKey);
            this.apiKeyInput.value = '••••••••••••••••';
        } else if (apiKey === '' && this.apiKeyInput.dataset.hasKey === 'true') {
            // User cleared the API key - remove it
            window.transcriptionService.setApiKey('');
            this.apiKeyInput.dataset.hasKey = 'false';
        }

        // Show success feedback
        const btn = this.saveSettingsBtn;
        const originalText = btn.innerHTML;
        btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Saved!';
        setTimeout(() => {
            btn.innerHTML = originalText;
            this.closeSettingsModal();
        }, 1000);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const recorder = new AudioRecorder();
    // Initialize transcription and settings after main app
    setTimeout(() => {
        recorder.initTranscription();
        recorder.initSettings();
    }, 100);
});
