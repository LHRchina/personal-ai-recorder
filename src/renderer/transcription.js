// Transcription Service - Supports Local Whisper and OpenAI API
// Toggle between methods in Settings

class TranscriptionService {
    constructor() {
        this.isTranscribing = false;
        this.apiKey = null;
        this.method = 'openai'; // 'local' or 'openai'
        this.onStatusChange = null;
        this.onResult = null;
        this.onError = null;
        this.loadSettings();
    }

    loadSettings() {
        this.apiKey = localStorage.getItem('openai_api_key');
        this.method = localStorage.getItem('transcription_method') || 'openai';
    }

    setApiKey(key) {
        this.apiKey = key;
        if (key) {
            localStorage.setItem('openai_api_key', key);
        } else {
            localStorage.removeItem('openai_api_key');
        }
    }

    getApiKey() {
        if (!this.apiKey) {
            this.apiKey = localStorage.getItem('openai_api_key');
        }
        return this.apiKey;
    }

    hasApiKey() {
        return !!this.getApiKey();
    }

    setMethod(method) {
        this.method = method;
        localStorage.setItem('transcription_method', method);
    }

    getMethod() {
        return this.method;
    }

    async transcribeFromPath(filePath) {
        this.isTranscribing = true;

        // Check if we need to convert to MP3 first
        let audioPath = filePath;
        if (filePath.endsWith('.webm')) {
            this.notifyStatus('converting', 'Converting to MP3...');
            const convertResult = await window.electronAPI.convertToMp3(filePath);
            if (!convertResult.success) {
                throw new Error('Failed to convert audio: ' + convertResult.error);
            }
            audioPath = convertResult.path;
        }

        let method = this.getMethod();

        // Auto-fallback to local if OpenAI is selected but no API key
        if (method === 'openai' && !this.hasApiKey()) {
            // Check if local whisper is available
            const localCheck = await window.electronAPI.checkLocalWhisper();
            if (localCheck.available) {
                method = 'local';
                this.notifyStatus('transcribing', 'No API key found. Using Local Whisper (this may take a moment)...');
            } else {
                throw new Error('OpenAI API key not configured and Local Whisper is not available. Please set an API key in Settings or install Local Whisper (pip install openai-whisper).');
            }
        } else if (method === 'openai') {
            this.notifyStatus('transcribing', 'Transcribing with OpenAI Whisper API...');
        } else {
            this.notifyStatus('transcribing', 'Transcribing with Local Whisper (this may take a moment)...');
        }

        try {
            const result = await window.electronAPI.transcribeAudio(
                audioPath,
                method,
                method === 'openai' ? this.getApiKey() : null
            );

            if (!result.success) {
                throw new Error(result.error);
            }

            this.notifyStatus('complete', `Transcription complete (${method})`);

            if (this.onResult) {
                this.onResult({
                    text: result.text,
                    method: result.method
                });
            }

            return result;
        } catch (error) {
            console.error('Transcription error:', error);
            this.notifyError('Transcription failed: ' + error.message);
            throw error;
        } finally {
            this.isTranscribing = false;
        }
    }

    notifyStatus(status, message) {
        if (this.onStatusChange) {
            this.onStatusChange({ status, message });
        }
    }

    notifyError(message) {
        if (this.onError) {
            this.onError(message);
        }
    }
}

// Export singleton instance
window.transcriptionService = new TranscriptionService();
