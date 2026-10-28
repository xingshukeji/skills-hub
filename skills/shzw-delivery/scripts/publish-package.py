"""Publish an original npm tarball using its product's Nexus Raw declaration.

Only Python's standard library is required. Credentials come from the caller's
environment; this module has no dependency on a CI checkout or consumer lock.
"""
import argparse
import base64
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tarfile
import tempfile
import urllib.error
import urllib.request

MAX_PACKAGE_BYTES = 16 * 1024**2


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write_json(path, value):
    """Readers must see a complete receipt or a complete delivered registry."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         prefix='.' + path.name + '-', delete=False) as stream:
            pending = Path(stream.name)
            stream.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
        os.replace(pending, path)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def project_file(project, relative):
    target = (Path(project) / relative).resolve()
    require(target.is_relative_to(Path(project).resolve()), 'Product file is outside the selected project')
    return target


def inspect_package(package, declaration, expected_sha256, expected_integrity=None, version=None):
    raw = Path(package).read_bytes()
    require(0 < len(raw) <= MAX_PACKAGE_BYTES, 'Public component size is invalid')
    sha256 = hashlib.sha256(raw).hexdigest()
    require(isinstance(expected_sha256, str) and re.fullmatch('[a-f0-9]{64}', expected_sha256)
            and sha256 == expected_sha256, 'Approved tarball SHA-256 differs')
    integrity = 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode()
    require(expected_integrity is None or expected_integrity == integrity, 'Approved tarball SHA-512 integrity differs')
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        members = archive.getmembers()
        require(len({item.name for item in members}) == len(members), 'Duplicate package member')
        require(all(item.isfile() or item.isdir() for item in members), 'Package links are forbidden')
        require(all(item.name.startswith('package/') and '..' not in item.name.split('/')
                    and '\\' not in item.name for item in members), 'Public component path traversal is forbidden')
        metadata = json.load(archive.extractfile('package/package.json'))
        require(metadata.get('name') == declaration['name'], 'Public component identity differs')
        observed_version = metadata.get('version')
        require(isinstance(observed_version, str)
                and re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', observed_version), 'Invalid public component version')
        require(version is None or version == observed_version, 'Public component version differs')
        version = observed_version
        build_path = declaration.get('buildMetadata')
        if build_path:
            build = json.load(archive.extractfile('package/' + build_path))
            require(build.get('name') == metadata['name'] and build.get('version') == version,
                    'Public component build identity differs')
        for fragment in declaration.get('forbiddenPathFragments', []):
            require(not any(fragment.lower() in item.name.lower() for item in members),
                    'Customer business cannot enter the public component')
        for name in declaration.get('requiredFiles', []):
            entry = archive.getmember('package/' + name)
            require(entry.isfile() and entry.size > 0, 'Public component entry is missing or empty')
    filename = declaration['filenamePrefix'] + version + '.tgz'
    require('/' not in filename and '\\' not in filename, 'Invalid public component filename')
    return raw, {'name': metadata['name'], 'version': version, 'filename': filename,
                 'sha256': sha256, 'integrity': integrity, 'bytes': len(raw),
                 'url': declaration['releaseRoot'].rstrip('/') + '/' + version + '/' + filename}


def request(url, method='GET', raw=None):
    headers = {'Accept': 'application/gzip'}
    if method == 'PUT':
        username = os.environ.get('XRAIN_NEXUS_PUBLISH_USER')
        password = os.environ.get('XRAIN_NEXUS_PUBLISH_PASSWORD')
        require(username and password, 'Caller Nexus publisher credentials are required')
        headers.update({'Authorization': 'Basic ' + base64.b64encode((username + ':' + password).encode()).decode(),
                        'Content-Type': 'application/gzip'})
    try:
        req = urllib.request.Request(url, data=raw, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=60) as response:
            content = response.read(MAX_PACKAGE_BYTES + 1)
            require(len(content) <= MAX_PACKAGE_BYTES, 'Unexpected Raw response size')
            return response.status, content
    except urllib.error.HTTPError as error:
        if method == 'GET' and error.code == 404:
            return 404, b''
        raise ValueError(f'Nexus {method} returned HTTP {error.code}; inspect the original operation') from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ValueError(f'Nexus {method} outcome is unknown; inspect the original operation') from None


def publish(raw, identity, evidence, authorization, *, http=request):
    require(authorization and authorization.strip(), 'Current publication authorization is required')
    require(hashlib.sha256(raw).hexdigest() == identity['sha256']
            and 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode() == identity['integrity'],
            'Publication bytes differ from the approved artifact')
    journal = Path(evidence) / 'publication.json'
    previous = read_json(journal) if journal.exists() else None
    if previous:
        require(previous.get('sha256') == identity['sha256'] and previous.get('url') == identity['url'],
                'Evidence belongs to another immutable publication')
    status, before = http(identity['url'])
    require(status in (200, 404), 'Shared package state could not be established')
    reused = status == 200
    if reused:
        require(before == raw, 'Existing immutable release has different bytes; it cannot be overwritten')
    else:
        require(previous is None, 'Prior publication outcome requires inspection before another write')
    result = dict(identity, authorizationRef=authorization, reused=reused,
                  status='started-result-unknown', startedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    # Claim a new operation before uploading. A concurrent invocation using the
    # same evidence directory cannot dispatch a second write.
    if previous is None:
        journal.parent.mkdir(parents=True, exist_ok=True)
        try:
            with journal.open('x', encoding='utf-8') as stream:
                stream.write(json.dumps(result, indent=2) + '\n')
        except FileExistsError:
            raise ValueError('Publication already has state; inspect the original operation') from None
    else:
        write_json(journal, result)
    if not reused:
        status, _ = http(identity['url'], 'PUT', raw)
        require(status in (200, 201, 204), 'Raw upload result is unknown; inspect the original operation')
    status, observed = http(identity['url'])
    require(status == 200 and observed == raw, 'Anonymous byte-for-byte publication readback differs')
    result.update(passed=True, status='verified', nexusByteReadback=True, anonymousDownload=True,
                  completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    write_json(journal, result)
    return result


def delivered_registry(project, declaration, identity, *, register=False):
    registration = declaration.get('delivered')
    if not registration:
        return False
    path = project_file(project, registration['path'])
    document = read_json(path)
    versions = document[registration['key']] if registration.get('key') else document
    existing = versions.get(identity['version'])
    require(existing is None or existing.get('integrity') == identity['integrity'],
            'Delivered version has different integrity; retain the original tarball')
    if register and existing is None:
        versions[identity['version']] = {'integrity': identity['integrity']}
        write_json(path, document)
    return register


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', default='.')
    parser.add_argument('--config', default='scripts/package-publication.json')
    parser.add_argument('--package', required=True)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--expected-integrity')
    parser.add_argument('--version')
    parser.add_argument('--evidence-directory', required=True)
    parser.add_argument('--authorization-ref')
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args(argv)
    project = Path(args.project).resolve()
    declaration = read_json(project_file(project, args.config))
    require(declaration.get('schemaVersion') == 1, 'Unsupported product publication declaration')
    package = Path(args.package)
    if not package.is_absolute():
        package = project / package
    raw, identity = inspect_package(package, declaration, args.expected_sha256, args.expected_integrity, args.version)
    delivered_registry(project, declaration, identity)
    if not args.execute:
        return dict(identity, prepared=True, networkAccessed=False)
    require(os.environ.get('XRAIN_NEXUS_PUBLISH_USER') and os.environ.get('XRAIN_NEXUS_PUBLISH_PASSWORD'),
            'Caller Nexus publisher credentials are required')
    evidence = Path(args.evidence_directory)
    if not evidence.is_absolute():
        evidence = project / evidence
    result = publish(raw, identity, evidence, args.authorization_ref)
    result['deliveredRegistered'] = delivered_registry(project, declaration, identity, register=True)
    write_json(evidence / 'publication.json', result)
    return result


if __name__ == '__main__':
    try:
        print(json.dumps(main()))
    except Exception as error:
        print(json.dumps({'passed': False, 'errorType': type(error).__name__,
                          'reason': str(error) if isinstance(error, ValueError)
                          else 'Inspect product inputs and the original publication receipt'}))
        raise SystemExit(1)
