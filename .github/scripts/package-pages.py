import json
from pathlib import Path
import shutil
import sys
from uuid import UUID


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def revision_number(document):
    if "revisionNumber" not in document:
        return None
    number = document["revisionNumber"]
    if type(number) not in (int, float) or not 1 <= number <= 2**53 - 1 or number % 1 != 0:
        raise ValueError(f"Invalid tournament revision number for {document['id']}")
    return number


def copy_file(source, target):
    if source.resolve() != source:
        raise ValueError(f"Website input must not be a symbolic link: {source.name}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def package_site(destination):
    source = Path(__file__).resolve().parents[2]
    config = read_json(source / "league.json")
    if config["templateVersion"] != 1:
        raise ValueError("Unsupported WooPair website template version")
    name = config["displayName"]
    if name is not None and (not isinstance(name, str) or not name.strip()):
        raise ValueError("Invalid league website name")

    data = Path("data/tournaments")
    index = read_json(source / data / "index.json")
    if index["schemaVersion"] != 1 or not isinstance(index["tournaments"], list):
        raise ValueError("Invalid tournament index")

    data_files = [data / "index.json"]
    seen = set()
    for entry in index["tournaments"]:
        event_id = str(UUID(entry["id"]))
        if event_id != entry["id"] or event_id in seen:
            raise ValueError("Invalid or repeated tournament ID in the index")
        seen.add(event_id)
        revision = str(UUID(entry["revision"]))
        if revision != entry["revision"]:
            raise ValueError(f"Invalid tournament revision for {event_id}")
        path = data / f"{event_id}.json"
        event = read_json(source / path)
        if event["schemaVersion"] != 1 or event["id"] != event_id or event["revision"] != revision:
            raise ValueError(f"Index and tournament revisions disagree for {event_id}")
        if revision_number(entry) != revision_number(event):
            raise ValueError(f"Index and tournament revision numbers disagree for {event_id}")
        phase = entry.get("phase")
        if phase not in ("SETUP", "LIVE", "COMPLETED") or event.get("phase") != phase:
            raise ValueError(f"Invalid or mismatched tournament phase for {event_id}")
        data_files.append(path)

    build = source / "dist"
    assets = sorted((build / "assets").iterdir())
    if not assets or any(not asset.is_file() or asset.suffix not in {".js", ".css"} for asset in assets):
        raise ValueError("Unexpected files in the built website assets")
    copy_file(build / "index.html", destination / "index.html")
    for asset in assets:
        copy_file(asset, destination / asset.relative_to(build))
    for path in data_files:
        copy_file(source / path, destination / path)
    # GitHub Pages in branch mode would serve the original config from the repository.
    if (source / "league.json").resolve() != source / "league.json":
        raise ValueError("Website input must not be a symbolic link: league.json")
    rendered = {**config, "deploymentSource": "workflow"}
    (destination / "league.json").write_text(json.dumps(rendered, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    package_site(Path(sys.argv[1]))
