#!/usr/bin/env python3
"""
Transcription script supporting both Local Whisper and OpenAI API
Usage: python transcribe.py <audio_file> <method> [api_key]
  method: 'local' or 'openai'
"""

import sys
import json
import os
import tempfile
import subprocess

# OpenAI's max file size limit (25MB)
MAX_FILE_SIZE = 25 * 1024 * 1024

def get_file_size(audio_path):
    """Get file size in bytes"""
    return os.path.getsize(audio_path)

def compress_audio(audio_path, max_size=MAX_FILE_SIZE):
    """Compress audio file using ffmpeg to fit within max_size"""
    current_size = get_file_size(audio_path)
    
    # If already under limit, no compression needed
    if current_size <= max_size:
        return audio_path
    
    # Create temporary file for compressed audio
    temp_dir = tempfile.gettempdir()
    temp_path = os.path.join(temp_dir, f"compressed_{os.path.basename(audio_path)}")
    
    # Calculate required compression ratio
    # Target slightly below max_size to account for encoding overhead
    ratio = (max_size * 0.95) / current_size
    
    # Determine target bitrate (minimum 16kbps for speech, max 64kbps)
    # Assuming average audio duration, calculate bitrate to fit
    try:
        # Get audio duration using ffprobe
        duration_cmd = [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", audio_path
        ]
        result = subprocess.run(duration_cmd, capture_output=True, text=True, check=True)
        duration = float(result.stdout.strip())
        
        # Calculate bitrate needed to fit in max_size (in kbps)
        # Leave some margin for metadata
        target_bitrate = int((max_size * 8 * 0.9) / duration / 1000)
        
        # Clamp bitrate between 16 and 64 kbps for good speech quality
        target_bitrate = max(16, min(64, target_bitrate))
        
    except Exception:
        # Fallback: use a conservative bitrate
        target_bitrate = 32
    
    # Compress using ffmpeg with calculated bitrate
    compress_cmd = [
        "ffmpeg", "-y", "-i", audio_path,
        "-ar", "16000",  # 16kHz is optimal for speech
        "-ac", "1",       # Mono
        "-b:a", f"{target_bitrate}k",
        "-f", "mp3",
        temp_path
    ]
    
    try:
        subprocess.run(compress_cmd, capture_output=True, check=True)
        
        compressed_size = get_file_size(temp_path)
        
        # If still too large, compress more aggressively
        if compressed_size > max_size:
            compress_cmd = [
                "ffmpeg", "-y", "-i", audio_path,
                "-ar", "16000",
                "-ac", "1",
                "-b:a", "16k",  # Minimum bitrate
                "-f", "mp3",
                temp_path
            ]
            subprocess.run(compress_cmd, capture_output=True, check=True)
        
        return temp_path
    except subprocess.CalledProcessError as e:
        raise Exception(f"Failed to compress audio: {e.stderr.decode()}")

def transcribe_local(audio_path):
    """Transcribe using local Whisper model with MPS acceleration"""
    try:
        import whisper
        model = whisper.load_model("base", device="mps")
        result = model.transcribe(audio_path)
        return {"success": True, "text": result["text"], "method": "local"}
    except Exception as e:
        return {"success": False, "error": str(e), "method": "local"}

def transcribe_openai(audio_path, api_key):
    """Transcribe using OpenAI Whisper API with automatic compression"""
    temp_file = None
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        
        # Check file size and compress if needed
        file_size = get_file_size(audio_path)
        if file_size > MAX_FILE_SIZE:
            audio_path = compress_audio(audio_path)
            temp_file = audio_path
        
        with open(audio_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file
            )
        return {"success": True, "text": transcription.text, "method": "openai"}
    except Exception as e:
        return {"success": False, "error": str(e), "method": "openai"}
    finally:
        # Clean up temporary compressed file if created
        if temp_file and temp_file != audio_path and os.path.exists(temp_file):
            try:
                os.remove(temp_file)
            except Exception:
                pass

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: transcribe.py <audio_file> <method> [api_key]"}))
        sys.exit(1)
    
    audio_path = sys.argv[1]
    method = sys.argv[2].lower()
    
    if not os.path.exists(audio_path):
        print(json.dumps({"success": False, "error": f"Audio file not found: {audio_path}"}))
        sys.exit(1)
    
    if method == "local":
        result = transcribe_local(audio_path)
    elif method == "openai":
        if len(sys.argv) < 4:
            print(json.dumps({"success": False, "error": "API key required for OpenAI method"}))
            sys.exit(1)
        api_key = sys.argv[3]
        result = transcribe_openai(audio_path, api_key)
    else:
        result = {"success": False, "error": f"Unknown method: {method}. Use 'local' or 'openai'"}
    
    print(json.dumps(result))

if __name__ == "__main__":
    main()
