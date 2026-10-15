"""Local word-level transcription with faster-whisper (no network service, no upload).

usage: python3 whisper_words.py <audio> <model> <language|auto> [--offline]
prints one JSON object: {language, model, text, segments[], words[]}
The model runs on this machine (CPU int8 by default). With --offline only an already
downloaded model is used (no download attempt).
"""
import json
import os
import sys


def main():
    audio, model, lang = sys.argv[1], sys.argv[2], sys.argv[3]
    offline = "--offline" in sys.argv
    from faster_whisper import WhisperModel  # noqa: import inside main so a missing package is a clear error

    device = os.environ.get("NITAAQ_WHISPER_DEVICE", "cpu")
    compute = os.environ.get("NITAAQ_WHISPER_COMPUTE", "int8")
    m = WhisperModel(model, device=device, compute_type=compute, local_files_only=offline)
    segments, info = m.transcribe(
        audio,
        language=None if lang == "auto" else lang,
        word_timestamps=True,
        vad_filter=False,
        beam_size=5,
        condition_on_previous_text=False,
    )
    segs, words, text = [], [], []
    for s in segments:
        segs.append({"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text})
        text.append(s.text)
        for w in s.words or []:
            words.append({"word": w.word, "start": round(w.start, 3), "end": round(w.end, 3), "probability": round(w.probability, 3)})
    print(json.dumps({"language": info.language, "model": model, "text": "".join(text), "segments": segs, "words": words}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except ImportError as e:
        print(json.dumps({"error": "faster-whisper not installed", "detail": str(e)}))
        sys.exit(3)
    except Exception as e:  # model download blocked, corrupt audio, …
        print(json.dumps({"error": type(e).__name__, "detail": str(e)[:400]}))
        sys.exit(4)
