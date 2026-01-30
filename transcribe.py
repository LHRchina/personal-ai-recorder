#!/usr/bin/env python3
"""
Transcription script supporting both Local Whisper and OpenAI API
Usage: python transcribe.py <audio_file> <method> [api_key]
  method: 'local' or 'openai'
"""

import sys
import json
import os

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
    """Transcribe using OpenAI Whisper API"""
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        
        with open(audio_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file
            )
        return {"success": True, "text": transcription.text, "method": "openai"}
    except Exception as e:
        return {"success": False, "error": str(e), "method": "openai"}

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
