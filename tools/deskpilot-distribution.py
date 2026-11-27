"""Build the small registry entry and reproducible content-addressed Raw artifacts."""
import argparse
import hashlib
import json
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/shzw-deskpilot-cli"
ENTRY = ROOT / "distributions/skillhub/shzw-deskpilot-cli"


def make_bundle(out, name, files):
    path = out / (name + ".zip")
    with zipfile.ZipFile(path, "w") as archive:
        for relative in sorted(files):
            info = zipfile.ZipInfo(relative)
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, (SKILL / relative).read_bytes())
    with path.open("rb") as stream:
        checksum = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return {"file": path.name, "bytes": path.stat().st_size, "sha256": checksum.hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, help="save release ZIP files to this directory")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    manifest = json.loads((SKILL / "vendor/manifest.json").read_text(encoding="utf-8"))
    fixed = manifest["files"]
    docs = [p.relative_to(SKILL).as_posix() for d in ("references", "tools") for p in (SKILL / d).rglob("*") if p.is_file() and "__pycache__" not in p.parts]
    with tempfile.TemporaryDirectory() as temporary:
        out = args.out or Path(temporary)
        out.mkdir(parents=True, exist_ok=True)
        models = [f["path"] for f in fixed if f["path"].startswith("assets/ocr/")]
        license_file = "vendor/licenses/PaddleOCR-LICENSE.txt"
        lock = {"models": make_bundle(out, "ocr", models + [license_file]), "platforms": {}}
        for platform in manifest["platforms"]:
            files = [f["path"] for f in fixed if f["path"] not in models and (not f.get("platforms") or platform in f["platforms"])]
            lock["platforms"][platform] = make_bundle(out, platform, files + docs + ["vendor/manifest.json", "SKILL.md"])
        dest = ENTRY / "artifacts.json"
        contents = json.dumps(lock, indent=2, sort_keys=True) + "\n"
        if args.check:
            if dest.read_text(encoding="utf-8") != contents:
                raise SystemExit("DeskPilot distribution changed. Rebuild it and publish the new Raw artifacts.")
        else:
            dest.write_bytes(contents.encode())


if __name__ == "__main__":
    main()
