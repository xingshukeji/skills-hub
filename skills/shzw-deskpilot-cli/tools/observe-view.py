#!/usr/bin/env python3
"""Optional focused view of a DeskPilot NDJSON stream; the underlying protocol is unchanged."""

from __future__ import annotations

import argparse
import base64
import copy
import datetime
import json
import os
import subprocess
import sys
import threading


LABEL_FIELDS = ("name", "text", "description", "content_description", "automation_id", "resource_id", "control_type", "class_name")
OBSERVATIONS = {"observe", "android.observe", "ui.tree", "ui.find", "ui.find_all"}


def validate_view(view):
    if not isinstance(view, dict) or set(view) - {"terms", "flags", "max_items"}:
        raise ValueError("view must contain only terms, flags and max_items")
    terms = view.get("terms", [])
    flags = view.get("flags", [])
    limit = view.get("max_items", 40)
    if not isinstance(terms, list) or not all(isinstance(x, str) and x for x in terms):
        raise ValueError("terms must be a list of nonempty strings")
    for term in terms:
        term.encode("utf-8")
    if not isinstance(flags, list) or not all(x in {"scrollable", "focused", "has_keyboard_focus", "editable", "clickable"} for x in flags):
        raise ValueError("flags must name supported boolean element properties")
    if not terms and not flags:
        raise ValueError("specify at least one term or flag; omit view for the complete response")
    if type(limit) is not int or not 1 <= limit <= 5000:
        raise ValueError("max_items must be an integer from 1 to 5000")
    return {"terms": [x.casefold() for x in terms], "flags": flags, "max_items": limit}


def focused_response(response, view):
    """Filter only element arrays, retaining source completeness and all other fields."""
    selected = validate_view(view)
    if not isinstance(response, dict):
        return response

    def walk(value):
        if isinstance(value, list):
            return [walk(item) for item in value]
        if not isinstance(value, dict):
            return value
        output = {}
        for key, item in value.items():
            if key != "elements" or not isinstance(item, list) or "observation_id" not in value:
                output[key] = walk(item)
                continue
            matches = []
            for index, element in enumerate(item):
                if not isinstance(element, dict):
                    continue
                labels = "\n".join(str(element.get(field, "")) for field in LABEL_FIELDS).casefold()
                if any(term in labels for term in selected["terms"]) or any(element.get(flag) is True for flag in selected["flags"]):
                    matches.append({**element, "_source_index": index})
            shown = matches[:selected["max_items"]]
            output[key] = shown
            output["_view"] = {"source_elements": len(item), "matched": len(matches), "shown": len(shown),
                               "output_truncated": len(shown) < len(matches)}
        return output

    return walk(response)


def run(command, record_path):
    output_lock = threading.Lock()
    state_lock = threading.Lock()
    record = open(record_path, "x", encoding="utf-8") if record_path else None
    pending = {}
    cached = None
    recording_error = None

    def emit(value):
        with output_lock:
            sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
            sys.stdout.flush()

    def save(kind, data):
        nonlocal recording_error
        if record is None or recording_error:
            return not recording_error
        try:
            with output_lock:
                record.write(json.dumps({"time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                                         "kind": kind, "body": data}, ensure_ascii=False) + "\n")
                record.flush()
            return True
        except (OSError, UnicodeError) as exc:
            recording_error = type(exc).__name__
            return False

    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        process = subprocess.Popen(command + ["exec", "--stdin", "--format", "ndjson"],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr,
                                   bufsize=-1, creationflags=creationflags)
    except OSError:
        if record:
            record.close()
        emit({"transport_error": {"code": "START_FAILED", "outcome": "not_dispatched"}})
        return 1

    def receive():
        nonlocal cached
        try:
            for line in process.stdout:
                try:
                    raw_response = line.decode("utf-8").rstrip("\r\n")
                    response = json.loads(raw_response)
                except (ValueError, UnicodeError):
                    recorded = save("invalid_response", {"raw_base64": base64.b64encode(line).decode("ascii")})
                    invalid = {"transport_error": {"code": "INVALID_RESPONSE", "outcome": "unknown"}}
                    if not recorded:
                        invalid["record_error"] = {"code": "RECORD_WRITE_FAILED", "type": recording_error}
                    emit(invalid)
                    continue
                recorded = save("response", {"raw": raw_response})
                response_id = response.get("id") if isinstance(response, dict) else None
                if not isinstance(response_id, (str, int, float)) or isinstance(response_id, bool):
                    emit({"transport_error": {"code": "INVALID_RESPONSE_ID", "outcome": "unknown"}, "response": response})
                    continue
                with state_lock:
                    entry = pending.pop(response_id, None)
                    cached = copy.deepcopy(response) if entry and entry["method"] in OBSERVATIONS and response.get("ok") is True and not pending else None
                if entry is None:
                    emit({"transport_error": {"code": "UNEXPECTED_RESPONSE", "outcome": "unknown"}, "response": response})
                    continue
                visible = focused_response(response, entry["view"]) if entry["view"] is not None else response
                if not recorded:
                    visible = {**visible, "record_error": {"code": "RECORD_WRITE_FAILED", "type": recording_error}}
                emit(visible)
        except (UnicodeError, OSError):
            emit({"transport_error": {"code": "STREAM_READ_FAILED", "outcome": "unknown"}})
        finally:
            with state_lock:
                unfinished = list(pending)
                pending.clear()
                cached = None
            if unfinished:
                emit({"transport_error": {"code": "STREAM_CLOSED", "outcome": "unknown", "pending_ids": unfinished}})

    receiver = threading.Thread(target=receive, name="deskpilot-response-reader", daemon=True)
    receiver.start()
    emit({"transport": "ready"})
    try:
        for line in sys.stdin:
            try:
                item = json.loads(line)
                if not isinstance(item, dict):
                    raise ValueError("each line must be an object")
                if "inspect" in item:
                    if set(item) != {"inspect"}:
                        raise ValueError("inspect cannot contain a request")
                    validate_view(item["inspect"])
                    with state_lock:
                        prior = copy.deepcopy(cached) if not pending else None
                    if prior is None:
                        emit({"transport_error": {"code": "NO_CURRENT_OBSERVATION", "outcome": "not_dispatched"}})
                    else:
                        recorded = save("inspect", item["inspect"])
                        result = focused_response(prior, item["inspect"])
                        visible = {**result, "cached_observation": True}
                        if not recorded:
                            visible["record_error"] = {"code": "RECORD_WRITE_FAILED", "type": recording_error}
                        emit(visible)
                    continue
                request = item.get("request", item)
                view = item.get("view") if "request" in item else None
                if "request" in item and set(item) - {"request", "view"}:
                    raise ValueError("request envelope may only contain request and view")
                if not isinstance(request, dict) or not isinstance(request.get("method"), str):
                    raise ValueError("request must contain a method")
                request_id = request.get("id", request.get("request_id"))
                if not isinstance(request_id, (str, int, float)) or isinstance(request_id, bool):
                    raise ValueError("request must contain a string or number id")
                if view is not None:
                    validate_view(view)
                encoded_request = (json.dumps(request, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode("utf-8")
                with state_lock:
                    if request_id in pending:
                        raise ValueError("request id is already pending")
                    pending[request_id] = {"view": view, "method": request["method"]}
                    cached = None
                recorded = save("request", {"raw": encoded_request.decode("utf-8").rstrip("\n")})
                if not recorded and request["method"] not in {"interaction.cancel", "interaction.end", "close"}:
                    with state_lock:
                        pending.pop(request_id, None)
                    emit({"id": request_id, "transport_error": {"code": "RECORD_WRITE_FAILED", "outcome": "not_dispatched"}})
                    continue
                process.stdin.write(encoded_request)
                process.stdin.flush()
                if request["method"] == "close":
                    break
            except (ValueError, TypeError) as exc:
                emit({"transport_error": {"code": "INVALID_INPUT", "message": str(exc), "outcome": "not_dispatched"}})
            except (BrokenPipeError, OSError):
                emit({"transport_error": {"code": "STREAM_WRITE_FAILED", "outcome": "unknown"}})
                break
    finally:
        try:
            process.stdin.close()
        except OSError:
            pass
        receiver.join()
        process.wait()
        if record:
            record.close()
    return process.returncode


def main():
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--command", required=True, help="absolute path to the installed DeskPilot command")
    parser.add_argument("--command-arg", action="append", default=[], help=argparse.SUPPRESS)
    parser.add_argument("--record", help="new NDJSON receipt file; never overwrites an existing file")
    args = parser.parse_args()
    try:
        return run([args.command, *args.command_arg], args.record)
    except OSError as exc:
        print(json.dumps({"transport_error": {"code": "RECORD_OPEN_FAILED", "type": type(exc).__name__,
                                             "outcome": "not_dispatched"}}), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
