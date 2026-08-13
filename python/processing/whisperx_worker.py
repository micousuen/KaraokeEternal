#!/usr/bin/env python3
"""Long-lived JSON-lines protocol for the WhisperX transcriber."""

import json
import os
import sys
import traceback

from whisperx_transcriber import WhisperXTranscriber


model_root = os.environ.get("HF_HOME", "/media/downloads/.karaoke-eternal-models")
transcriber = WhisperXTranscriber(model_root)


def emit(message):
    print(json.dumps(message), flush=True)


def respond(request, event, **fields):
    emit({"id": request["id"], "event": event, **fields})


def handle(request):
    command = request.get("command")
    if command == "mount":
        transcriber.mount(request["settings"])
        respond(request, "mounted")
    elif command == "transcribe":
        transcriber.mount(request["settings"])
        result = transcriber.transcribe(
            request["audio"],
            request["outputDir"],
            request["settings"],
            lambda event, **fields: respond(request, event, **fields),
        )
        respond(request, "complete", **result)
    elif command in {"unmount", "shutdown"}:
        transcriber.unmount()
        respond(request, "unmounted")
        return command != "shutdown"
    else:
        raise ValueError(f"Unknown command: {command}")
    return True


def main():
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            if not handle(request):
                return
        except Exception as error:
            emit({
                "id": request.get("id") if isinstance(request, dict) else None,
                "event": "error",
                "error": str(error),
                "traceback": traceback.format_exc(),
            })


if __name__ == "__main__":
    main()
