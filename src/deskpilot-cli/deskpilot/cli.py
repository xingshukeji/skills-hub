"""argv and ordered NDJSON transport; stdout contains protocol results only."""

from __future__ import annotations

import json
import queue
import sys
import threading
import uuid

from . import DeskPilotError, VERSION, require

MAX_REQUEST_BYTES = 8 * 1024 * 1024
HELP = """DeskPilot — local desktop and Chrome operations
Usage: deskpilot <method> [--key value] [--format json]
       deskpilot <domain> <command> [--params-json JSON]
       deskpilot exec --stdin --format ndjson

Start with capabilities, schema or doctor. Keep one exec process for observations,
actions, batches and cancellation. Methods and failures are documented by schema.
"""


def envelope(request_id, *, result=None, error: DeskPilotError | None = None) -> dict:
    reply = {"id": request_id, "request_id": request_id, "ok": error is None}
    if error is None:
        reply["result"] = result
    else:
        reply["error"] = error.body()
    return reply


def parse_request(value) -> tuple:
    require(isinstance(value, dict), "INVALID_REQUEST", "A request must be an object.")
    request_id = value.get("id", value.get("request_id", uuid.uuid4().hex))
    require(isinstance(request_id, (str, int, float)) and not isinstance(request_id, bool),
            "INVALID_REQUEST", "id must be a string or number.")
    method = value.get("method", value.get("op"))
    require(isinstance(method, str) and bool(method.strip()), "INVALID_REQUEST", "A request must contain method.")
    params = value.get("params", value.get("parameters", {}))
    require(isinstance(params, dict), "INVALID_REQUEST", "params must be an object.")
    return request_id, method, {key.replace("-", "_"): item for key, item in params.items()}


def parse_argv(argv: list[str]) -> tuple[str, dict]:
    positional, parameters = [], {}
    index = 0
    while index < len(argv):
        value = argv[index]
        if not value.startswith("--"):
            positional.append(value.replace("-", "_"))
            index += 1
            continue
        key, separator, item = value[2:].partition("=")
        key = key.replace("-", "_")
        if not separator:
            if index + 1 < len(argv) and not argv[index + 1].startswith("--"):
                index += 1
                item = argv[index]
            else:
                item = "true"
        if key not in {"format", "json", "stdin"}:
            if key == "params_json":
                try:
                    supplied = json.loads(item)
                except ValueError:
                    raise DeskPilotError("INVALID_ARGUMENT", "params-json must contain a JSON object.") from None
                require(isinstance(supplied, dict), "INVALID_ARGUMENT", "params-json must contain an object.")
                parameters.update(supplied)
            else:
                try:
                    parameters[key] = json.loads(item)
                except ValueError:
                    parameters[key] = item
        index += 1
    return ".".join(positional) or "capabilities", parameters


def run_stream(source, destination, session_factory=None) -> int:
    from .session import Session
    factory = session_factory or Session
    work = queue.Queue()
    output_lock = threading.Lock()
    ready = threading.Event()
    holder = {}

    def emit(value):
        with output_lock:
            destination.write(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
            destination.flush()

    def execute():
        try:
            holder["session"] = factory()
        except Exception as exc:
            holder["startup_error"] = exc
        finally:
            ready.set()
        session = holder.get("session")
        try:
            while True:
                request = work.get()
                if request is None:
                    return
                request_id, method, params, generation = request
                try:
                    if session is None:
                        raise DeskPilotError("STARTUP_FAILED", "The desktop backend could not initialize.")
                    result = session.execute(method, params, cancellation_generation=generation)
                    emit(envelope(request_id, result=result))
                except DeskPilotError as exc:
                    emit(envelope(request_id, error=exc))
                except Exception as exc:
                    emit(envelope(request_id, error=DeskPilotError("INTERNAL_ERROR", f"Operation failed ({type(exc).__name__}).")))
                if method == "close":
                    return
        finally:
            if session is not None:
                session.close()

    worker = threading.Thread(target=execute, name="deskpilot-requests")
    worker.start()
    try:
        while True:
            raw = source.readline(MAX_REQUEST_BYTES + 1)
            if not raw:
                break
            request_id = None
            try:
                if len(raw.encode("utf-8") if isinstance(raw, str) else raw) > MAX_REQUEST_BYTES:
                    while raw and not raw.endswith(b"\n" if isinstance(raw, bytes) else "\n"):
                        raw = source.readline(MAX_REQUEST_BYTES + 1)
                    raise DeskPilotError("REQUEST_TOO_LARGE", "Request exceeds 8 MiB.")
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8-sig")
                if not raw.strip():
                    continue
                value = json.loads(raw.lstrip("\ufeff"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                if isinstance(value, dict):
                    request_id = value.get("id", value.get("request_id"))
                request = parse_request(value)
                request_id, method, params = request
                if method == "interaction.cancel":
                    ready.wait()
                    session = holder.get("session")
                    result = session.request_cancel() if session is not None else {"status": "idle"}
                    emit(envelope(request_id, result=result))
                else:
                    ready.wait()
                    session = holder.get("session")
                    work.put((*request, session.cancellation_generation if session is not None else None))
                if method == "close":
                    break
            except (ValueError, UnicodeError):
                emit(envelope(request_id, error=DeskPilotError("INVALID_JSON", "Request must be valid UTF-8 JSON.")))
            except DeskPilotError as exc:
                emit(envelope(request_id, error=exc))
    except (KeyboardInterrupt, BrokenPipeError):
        ready.wait()
        if holder.get("session") is not None:
            holder["session"].request_cancel()
    finally:
        work.put(None)
        worker.join()
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="strict")
    if not argv or "--help" in argv or "-h" in argv:
        print(HELP, end="")
        return 0
    if argv == ["--version"]:
        print(VERSION)
        return 0
    if argv[0] == "exec":
        return run_stream(getattr(sys.stdin, "buffer", sys.stdin), sys.stdout)
    from .session import Session
    request_id = uuid.uuid4().hex
    session = None
    try:
        method, params = parse_argv(argv)
        session = Session()
        reply = envelope(request_id, result=session.execute(method, params))
    except DeskPilotError as exc:
        reply = envelope(request_id, error=exc)
    except Exception as exc:
        reply = envelope(request_id, error=DeskPilotError("INTERNAL_ERROR", f"Operation failed ({type(exc).__name__})."))
    finally:
        if session is not None:
            session.close()
    print(json.dumps(reply, ensure_ascii=False, allow_nan=False))
    return 0 if reply["ok"] else 1
