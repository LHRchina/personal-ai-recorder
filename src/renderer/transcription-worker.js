// Transcription Worker using Whisper via Transformers.js
// This runs in a Web Worker for non-blocking transcription

import { pipeline } from '@xenova/transformers';

let transcriber = null;
let isModelLoading = false;

// Initialize the Whisper model
async function initModel(modelName = 'Xenova/whisper-tiny') {
    if (transcriber || isModelLoading) return;

    isModelLoading = true;
    self.postMessage({ type: 'status', status: 'loading', message: 'Loading Whisper model...' });

    try {
        transcriber = await pipeline('automatic-speech-recognition', modelName, {
            quantized: true, // Use quantized model for faster loading
        });

        self.postMessage({ type: 'status', status: 'ready', message: 'Model loaded successfully' });
    } catch (error) {
        self.postMessage({ type: 'error', error: error.message });
    } finally {
        isModelLoading = false;
    }
}

// Transcribe audio data
async function transcribe(audioData, language = 'en') {
    if (!transcriber) {
        await initModel();
    }

    try {
        self.postMessage({ type: 'status', status: 'transcribing', message: 'Transcribing audio...' });

        const result = await transcriber(audioData, {
            language: language,
            task: 'transcribe',
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: true,
        });

        self.postMessage({
            type: 'result',
            text: result.text,
            chunks: result.chunks || []
        });
    } catch (error) {
        self.postMessage({ type: 'error', error: error.message });
    }
}

// Handle messages from main thread
self.onmessage = async (event) => {
    const { type, data } = event.data;

    switch (type) {
        case 'init':
            await initModel(data?.model);
            break;
        case 'transcribe':
            await transcribe(data.audio, data.language);
            break;
        default:
            console.warn('Unknown message type:', type);
    }
};
