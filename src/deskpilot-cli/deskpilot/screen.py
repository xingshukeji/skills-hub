"""RGB images and offline PP-OCRv6 Tiny inference through ONNX Runtime's C API."""

from __future__ import annotations

from array import array
import ctypes as C
from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
import struct
import sys
import zlib

from . import DeskPilotError, platform_key, require, resource_root, vendor_paths


def pillow():
    vendor_paths()
    try:
        from PIL import Image as PillowImage
        return PillowImage
    except (ImportError, OSError) as exc:
        raise DeskPilotError("IMAGE_BACKEND_UNAVAILABLE", f"The bundled image backend could not load ({type(exc).__name__}).") from None


@dataclass(frozen=True)
class Image:
    width: int
    height: int
    rgb: bytes

    def __post_init__(self):
        require(self.width > 0 and self.height > 0 and len(self.rgb) == self.width * self.height * 3,
                "IMAGE_INVALID", "The image is not a complete RGB frame.")

    @classmethod
    def open(cls, path):
        with pillow().open(path) as image:
            converted = image.convert("RGB")
            return cls(converted.width, converted.height, converted.tobytes())

    def pil(self):
        return pillow().frombytes("RGB", (self.width, self.height), self.rgb)

    def resize(self, width, height):
        resized = self.pil().resize((width, height), pillow().Resampling.BILINEAR)
        return Image(width, height, resized.tobytes())

    def crop(self, area, *, rotate=0):
        require(area["x"] >= 0 and area["y"] >= 0 and area["width"] > 0 and area["height"] > 0
                and area["x"] + area["width"] <= self.width and area["y"] + area["height"] <= self.height,
                "INVALID_ARGUMENT", "The crop must be inside the image.")
        if not rotate:
            stride = self.width * 3
            return Image(area["width"], area["height"], b"".join(
                self.rgb[row * stride + area["x"] * 3:row * stride + (area["x"] + area["width"]) * 3]
                for row in range(area["y"], area["y"] + area["height"])))
        image = self.pil().crop((area["x"], area["y"], area["x"] + area["width"], area["y"] + area["height"]))
        if rotate:
            image = image.rotate(rotate, expand=True)
        return Image(image.width, image.height, image.tobytes())

    def png(self) -> bytes:
        def chunk(name, data):
            return struct.pack("!I", len(data)) + name + data + struct.pack("!I", zlib.crc32(name + data) & 0xFFFFFFFF)
        rows = bytearray()
        stride = self.width * 3
        for row in range(self.height):
            rows.append(0)
            rows.extend(self.rgb[row * stride:(row + 1) * stride])
        return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!IIBBBBB", self.width, self.height, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(rows, 3)) + chunk(b"IEND", b""))


def target_region_changed(before: Image, after: Image, region: dict, checkpoint=lambda: None) -> bool:
    """Compare only the chosen target, tolerating small caret/antialiasing changes."""
    if (before.width, before.height) != (after.width, after.height):
        return True
    left, right = before.crop(region).rgb, after.crop(region).rgb
    changed = 0
    for i in range(0, len(left), 3):
        if i % (4096 * 3) == 0:
            checkpoint()
        changed += max(abs(left[i + channel] - right[i + channel]) for channel in range(3)) > 24
    return changed > (len(left) // 3) * 0.03


class Ort:
    """Small typed binding to the pinned public OrtApi v23 table.

    Slots come from microsoft/onnxruntime v1.23.2, onnxruntime_c_api.h.
    No Python ONNX package, package resolver, or managed runtime is involved.
    """

    SLOTS = {"CreateEnv": 3, "GetErrorCode": 1, "GetErrorMessage": 2, "CreateSession": 7,
             "CreateSessionOptions": 10, "SetSessionGraphOptimizationLevel": 23, "SetIntraOpNumThreads": 24,
             "CreateCpuMemoryInfo": 69, "CreateTensorWithDataAsOrtValue": 49, "Run": 9,
             "GetTensorMutableData": 51, "GetTensorTypeAndShape": 65, "GetDimensionsCount": 61,
             "GetDimensions": 62, "GetTensorShapeElementCount": 64, "ReleaseEnv": 92,
             "ReleaseStatus": 93, "ReleaseMemoryInfo": 94, "ReleaseSession": 95, "ReleaseValue": 96,
             "ReleaseTensorTypeAndShapeInfo": 99, "ReleaseSessionOptions": 100,
             "GetAllocatorWithDefaultOptions": 78, "SessionGetInputName": 36, "SessionGetOutputName": 37,
             "AllocatorFree": 76, "SetSessionLogSeverityLevel": 22}

    def __init__(self):
        folder = resource_root() / "vendor" / platform_key()
        name = "onnxruntime.dll" if sys.platform == "win32" else "libonnxruntime.1.23.2.dylib" if sys.platform == "darwin" else "libonnxruntime.so.1.23.2"
        path = folder / name
        require(path.is_file(), "OCR_UNAVAILABLE", "The native OCR inference library is not included for this platform.")
        self._dll_directory = os.add_dll_directory(str(folder)) if sys.platform == "win32" else None
        try:
            self.library = (C.WinDLL if sys.platform == "win32" else C.CDLL)(str(path))
        except OSError as exc:
            if self._dll_directory:
                self._dll_directory.close()
            raise DeskPilotError("OCR_UNAVAILABLE", f"The bundled inference library could not load ({type(exc).__name__}); check its system runtime prerequisites.") from None
        self._function_type = C.WINFUNCTYPE if sys.platform == "win32" else C.CFUNCTYPE
        get_api_type = self._function_type(C.c_void_p, C.c_uint32)
        get_version_type = self._function_type(C.c_char_p)

        class ApiBase(C.Structure):
            _fields_ = [("GetApi", get_api_type), ("GetVersionString", get_version_type)]

        self.library.OrtGetApiBase.restype = C.POINTER(ApiBase)
        api_base = self.library.OrtGetApiBase().contents
        self.version = api_base.GetVersionString().decode("ascii")
        table = api_base.GetApi(23)
        require(bool(table), "OCR_UNAVAILABLE", "The inference library does not expose the required public C API.")
        self._table = C.cast(table, C.POINTER(C.c_void_p))
        self._functions = {}
        self.environment, self.memory = C.c_void_p(), C.c_void_p()
        self.check(self.function("CreateEnv", C.c_void_p, C.c_int, C.c_char_p, C.POINTER(C.c_void_p))(3, b"DeskPilot", C.byref(self.environment)))
        self.check(self.function("CreateCpuMemoryInfo", C.c_void_p, C.c_int, C.c_int, C.POINTER(C.c_void_p))(1, 0, C.byref(self.memory)))

    def function(self, name, restype, *args):
        key = (name, restype, args)
        if key not in self._functions:
            self._functions[key] = self._function_type(restype, *args)(self._table[self.SLOTS[name]])
        return self._functions[key]

    def check(self, status):
        if status:
            code = self.function("GetErrorCode", C.c_int, C.c_void_p)(status)
            self.function("ReleaseStatus", None, C.c_void_p)(status)
            raise DeskPilotError("OCR_INFERENCE_FAILED", "The native inference engine rejected an operation.", details={"native_code": code})

    def close(self):
        if self.memory:
            self.function("ReleaseMemoryInfo", None, C.c_void_p)(self.memory)
            self.memory = None
        if self.environment:
            self.function("ReleaseEnv", None, C.c_void_p)(self.environment)
            self.environment = None
        if self._dll_directory:
            self._dll_directory.close()
            self._dll_directory = None


class Model:
    def __init__(self, ort: Ort, path: Path):
        self.ort, self.session = ort, C.c_void_p()
        options = C.c_void_p()
        ort.check(ort.function("CreateSessionOptions", C.c_void_p, C.POINTER(C.c_void_p))(C.byref(options)))
        try:
            ort.check(ort.function("SetIntraOpNumThreads", C.c_void_p, C.c_void_p, C.c_int)(options, min(os.cpu_count() or 1, 4)))
            ort.check(ort.function("SetSessionGraphOptimizationLevel", C.c_void_p, C.c_void_p, C.c_int)(options, 99))
            argument_type = C.c_wchar_p if sys.platform == "win32" else C.c_char_p
            argument = str(path) if sys.platform == "win32" else os.fsencode(path)
            ort.check(ort.function("CreateSession", C.c_void_p, C.c_void_p, argument_type, C.c_void_p, C.POINTER(C.c_void_p))(
                ort.environment, argument, options, C.byref(self.session)))
        finally:
            ort.function("ReleaseSessionOptions", None, C.c_void_p)(options)
        allocator = C.c_void_p()
        ort.check(ort.function("GetAllocatorWithDefaultOptions", C.c_void_p, C.POINTER(C.c_void_p))(C.byref(allocator)))
        names = []
        for function in ("SessionGetInputName", "SessionGetOutputName"):
            pointer = C.c_void_p()
            ort.check(ort.function(function, C.c_void_p, C.c_void_p, C.c_size_t, C.c_void_p, C.POINTER(C.c_void_p))(
                self.session, 0, allocator, C.byref(pointer)))
            try:
                names.append(C.string_at(pointer))
            finally:
                ort.check(ort.function("AllocatorFree", C.c_void_p, C.c_void_p, C.c_void_p)(allocator, pointer))
        self.input_name, self.output_name = names

    def run(self, values: array, shape: tuple[int, ...]):
        require(values.typecode == "f" and len(values) == math.prod(shape), "OCR_INPUT_INVALID", "The inference tensor shape does not match its data.")
        ort = self.ort
        tensor, output, info = C.c_void_p(), C.c_void_p(), C.c_void_p()
        dimensions = (C.c_int64 * len(shape))(*shape)
        address, count = values.buffer_info()
        ort.check(ort.function("CreateTensorWithDataAsOrtValue", C.c_void_p, C.c_void_p, C.c_void_p, C.c_size_t,
                               C.POINTER(C.c_int64), C.c_size_t, C.c_int, C.POINTER(C.c_void_p))(
            ort.memory, address, count * values.itemsize, dimensions, len(shape), 1, C.byref(tensor)))
        try:
            names_in, names_out = (C.c_char_p * 1)(self.input_name), (C.c_char_p * 1)(self.output_name)
            inputs = (C.c_void_p * 1)(tensor.value)
            ort.check(ort.function("Run", C.c_void_p, C.c_void_p, C.c_void_p, C.POINTER(C.c_char_p),
                                   C.POINTER(C.c_void_p), C.c_size_t, C.POINTER(C.c_char_p), C.c_size_t, C.POINTER(C.c_void_p))(
                self.session, None, names_in, inputs, 1, names_out, 1, C.byref(output)))
            ort.check(ort.function("GetTensorTypeAndShape", C.c_void_p, C.c_void_p, C.POINTER(C.c_void_p))(output, C.byref(info)))
            rank, length = C.c_size_t(), C.c_size_t()
            ort.check(ort.function("GetDimensionsCount", C.c_void_p, C.c_void_p, C.POINTER(C.c_size_t))(info, C.byref(rank)))
            require(0 < rank.value <= 8, "OCR_OUTPUT_INVALID", "The model returned an unsupported tensor rank.")
            shape_out = (C.c_int64 * rank.value)()
            ort.check(ort.function("GetDimensions", C.c_void_p, C.c_void_p, C.POINTER(C.c_int64), C.c_size_t)(info, shape_out, rank.value))
            ort.check(ort.function("GetTensorShapeElementCount", C.c_void_p, C.c_void_p, C.POINTER(C.c_size_t))(info, C.byref(length)))
            require(0 < length.value <= 32_000_000, "OCR_OUTPUT_INVALID", "The model output is outside the supported size.")
            pointer = C.c_void_p()
            ort.check(ort.function("GetTensorMutableData", C.c_void_p, C.c_void_p, C.POINTER(C.c_void_p))(output, C.byref(pointer)))
            result = array("f")
            result.frombytes(C.string_at(pointer, length.value * 4))
            return result, tuple(shape_out)
        finally:
            if info:
                ort.function("ReleaseTensorTypeAndShapeInfo", None, C.c_void_p)(info)
            if output:
                ort.function("ReleaseValue", None, C.c_void_p)(output)
            ort.function("ReleaseValue", None, C.c_void_p)(tensor)

    def close(self):
        if self.session:
            self.ort.function("ReleaseSession", None, C.c_void_p)(self.session)
            self.session = None


def normalized(image: Image, width: int, height: int, means, deviations, *, padded_width=None) -> array:
    resized = image.resize(width, height)
    channels = (resized.rgb[2::3], resized.rgb[1::3], resized.rgb[0::3])
    result = array("f")
    for channel, mean, deviation in zip(channels, means, deviations):
        lookup = [(value / 255 - mean) / deviation for value in range(256)]
        if padded_width is None or padded_width == width:
            result.extend(lookup[value] for value in channel)
        else:
            padding = array("f", [0.0]) * (padded_width - width)
            for row in range(height):
                result.extend(lookup[value] for value in channel[row * width:(row + 1) * width])
                result.extend(padding)
    return result


def connected_boxes(probabilities: array, width: int, height: int, *, threshold=0.2, box_threshold=0.4, unclip=1.4):
    """Run-length components avoid a per-pixel Python object graph."""
    parents, statistics, previous = [], [], []

    def root(label):
        while parents[label] != label:
            parents[label] = parents[parents[label]]
            label = parents[label]
        return label

    def merge(left, right):
        left, right = root(left), root(right)
        if left == right:
            return left
        if left > right:
            left, right = right, left
        parents[right] = left
        a, b = statistics[left], statistics[right]
        a[0], a[1], a[2], a[3] = min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])
        a[4], a[5] = a[4] + b[4], a[5] + b[5]
        return left

    for y in range(height):
        current, x, prior_index = [], 0, 0
        offset = y * width
        while x < width:
            if probabilities[offset + x] < threshold:
                x += 1
                continue
            start, score = x, 0.0
            while x < width and probabilities[offset + x] >= threshold:
                score += probabilities[offset + x]
                x += 1
            end = x
            while prior_index < len(previous) and previous[prior_index][1] < start:
                prior_index += 1
            overlap, index = [], prior_index
            while index < len(previous) and previous[index][0] <= end:
                overlap.append(previous[index][2])
                index += 1
            if overlap:
                label = root(overlap[0])
                for other in overlap[1:]:
                    label = merge(label, other)
                item = statistics[label]
                item[0], item[2], item[3] = min(item[0], start), max(item[2], end), y + 1
                item[4], item[5] = item[4] + score, item[5] + end - start
            else:
                label = len(parents)
                parents.append(label)
                statistics.append([start, y, end, y + 1, score, end - start])
            current.append((start, end, label))
        previous = current
    result = []
    for index, item in enumerate(statistics):
        if root(index) != index:
            continue
        x0, y0, x1, y1, score, count = item
        if x1 - x0 < 2 or y1 - y0 < 2 or score / count < box_threshold:
            continue
        margin = (x1 - x0) * (y1 - y0) * unclip / (2 * (x1 - x0 + y1 - y0))
        left, top = max(0, math.floor(x0 - margin)), max(0, math.floor(y0 - margin))
        right, bottom = min(width, math.ceil(x1 + margin)), min(height, math.ceil(y1 + margin))
        result.append({"x": left, "y": top, "width": right - left, "height": bottom - top})
    return sorted(result, key=lambda area: (area["y"], area["x"]))


def ctc_decode(values: array, shape, dictionary: list[str]) -> tuple[str, float]:
    require(len(shape) == 3 and shape[0] == 1 and shape[2] == len(dictionary),
            "OCR_MODEL_MISMATCH", "The recognition model and bundled dictionary do not agree.")
    text, scores, previous = [], [], None
    classes = shape[2]
    for step in range(shape[1]):
        row = values[step * classes:(step + 1) * classes]
        selected = max(range(classes), key=row.__getitem__)
        if selected and selected != previous:
            text.append(dictionary[selected])
            scores.append(float(row[selected]))
        previous = selected
    return "".join(text), sum(scores) / len(scores) if scores else 0.0


class Ocr:
    def __init__(self):
        self.ort = None
        self.models = []
        try:
            pillow()
            folder = resource_root() / "assets" / "ocr"
            require(all((folder / name).is_file() for name in ("det.onnx", "rec.onnx", "cls.onnx", "dictionary.json")),
                    "OCR_UNAVAILABLE", "The complete offline Tiny model resources are not available.")
            self.dictionary = [""] + json.loads((folder / "dictionary.json").read_text(encoding="utf-8")) + [" "]
            self.ort = Ort()
            for name in ("det.onnx", "rec.onnx", "cls.onnx"):
                self.models.append(Model(self.ort, folder / name))
            self.detector, self.recognizer, self.classifier = self.models
        except Exception:
            self.close()
            raise

    @classmethod
    def diagnose(cls):
        reader = None
        try:
            reader = cls()
            return {"available": True, "backend": "pp_ocrv6_tiny_onnx_cpu", "offline": True,
                    "inference_version": reader.ort.version, "language": "zh",
                    "word_localization": {"available": False, "status": "no_verified_word_localizer"}}
        except DeskPilotError as exc:
            return {"available": False, "backend": "pp_ocrv6_tiny_onnx_cpu", "offline": True, "error_code": exc.code}
        finally:
            if reader:
                reader.close()

    def read(self, image: Image, checkpoint, *, include_words=False):
        checkpoint()
        ratio = min(1.0, 960 / max(image.width, image.height))
        width = max(32, round(image.width * ratio / 32) * 32)
        height = max(32, round(image.height * ratio / 32) * 32)
        mean, deviation = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)
        values, shape = self.detector.run(normalized(image, width, height, mean, deviation), (1, 3, height, width))
        checkpoint()
        require(len(shape) == 4 and shape[:2] == (1, 1), "OCR_MODEL_MISMATCH", "The detection model returned an unexpected shape.")
        areas = connected_boxes(values, shape[3], shape[2])
        blocks = []
        for area in areas[:500]:
            checkpoint()
            left = max(0, math.floor(area["x"] * image.width / shape[3]))
            top = max(0, math.floor(area["y"] * image.height / shape[2]))
            right = min(image.width, math.ceil((area["x"] + area["width"]) * image.width / shape[3]))
            bottom = min(image.height, math.ceil((area["y"] + area["height"]) * image.height / shape[2]))
            original = {"x": left, "y": top, "width": right - left, "height": bottom - top}
            if original["width"] <= 1 or original["height"] <= 1:
                continue
            crop = image.crop(original, rotate=90 if original["height"] > original["width"] * 1.5 else 0)
            orientation, orientation_shape = self.classifier.run(normalized(crop, 160, 80, mean, deviation), (1, 3, 80, 160))
            require(len(orientation) == 2, "OCR_MODEL_MISMATCH", "The orientation model returned an unexpected shape.")
            rotation = 180 if orientation[1] > orientation[0] and orientation[1] >= 0.9 else 0
            if rotation:
                crop = crop.crop({"x": 0, "y": 0, "width": crop.width, "height": crop.height}, rotate=rotation)
            padded_width = min(3200, max(320, math.ceil(48 * crop.width / crop.height)))
            resized_width = min(padded_width, math.ceil(48 * crop.width / crop.height))
            recognized, recognized_shape = self.recognizer.run(
                normalized(crop, resized_width, 48, (0.5,) * 3, (0.5,) * 3, padded_width=padded_width),
                (1, 3, 48, padded_width))
            text, confidence = ctc_decode(recognized, recognized_shape, self.dictionary)
            if not text.strip():
                continue
            blocks.append({"block_id": f"text_{len(blocks) + 1:04d}", "text": text, "confidence": confidence,
                           "bounds": original, "words": [], "rotation": rotation})
        checkpoint()
        return {"backend": "pp_ocrv6_tiny_onnx_cpu", "language": "zh", "offline": True,
                "width": image.width, "height": image.height, "text": "\n".join(item["text"] for item in blocks),
                "blocks": blocks, "truncated": len(areas) > 500,
                "word_localization": {"status": "no_verified_word_localizer" if include_words else "not_requested", "matched_blocks": 0}}

    def close(self):
        for model in self.models:
            model.close()
        self.models.clear()
        if self.ort:
            self.ort.close()
            self.ort = None
