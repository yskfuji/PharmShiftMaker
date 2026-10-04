"""Actual kernel ENOSPC, limited to an owned 64KiB tmpfs; synthetic PG only."""

import json
import os
import shutil
import subprocess
from pathlib import Path
from uuid import uuid4

import pytest

CONTAINER_PROGRAM = r"""
import errno, hashlib, json, os
from pathlib import Path
from uuid import uuid4
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from shift_scheduler.ops import managed_writer as writer
from shift_scheduler.domain.copies import CopyRegistration
from shift_scheduler.domain.planning import Evidence
from shift_scheduler.db.compliance_models import ManagedCopy, CopySubject
from shift_scheduler.application.storage_reconciliation import file_observation

factory = sessionmaker(create_engine(os.environ['TEST_DATABASE_URL']), expire_on_commit=False)
root = Path('/audit-managed')
capacity = os.statvfs(root).f_blocks * os.statvfs(root).f_frsize
assert 0 < capacity <= 65536, capacity
scope = 'hospital/pharmacy'
content = b'synthetic p0 source'
digest = hashlib.sha256(content).hexdigest()
identity, output = uuid4().hex, uuid4().hex
item = CopyRegistration(copy_id=identity, relative_path=identity, medium='file', category='exports',
    content_hash=digest, person_ids=('p0',), anchor='last_activity', anchor_at='2020-01-01T00:00:00Z',
    evidence=Evidence(reference='synthetic capacity fault fixture',status='verified',verified_by='officer'),
    subject_status='VERIFIED')
writer.reserve(factory, scope, item, 'schedule.json', 'a'*64)
writer.publish_bytes(factory, scope, identity, content)
writer.reserve_capture(factory, scope, output, 'replica', {identity:digest})
with factory() as session:
    assert session.get(ManagedCopy,output).state == 'CAPTURE_RESERVED'
states = ['CAPTURE_RESERVED']
def exceed(stream):
    with factory() as session:
        assert session.get(ManagedCopy,output).state == 'CAPTURING'
    states.append('CAPTURING')
    stream.write(b'x' * (capacity + 65536))
error = None
try:
    writer.capture(factory, scope, output, exceed)
except OSError as exc:
    error = exc.errno
assert error == errno.ENOSPC, error
assert not (root/output).exists()
assert (root/('.pending-'+output)).exists()
with factory() as session:
    row = session.get(ManagedCopy,output)
    assert row.state == 'CAPTURE_RETRY'
    assert row.evidence['hash_pending'] is True
    assert set(session.scalars(select(CopySubject.person_id).where(CopySubject.copy_id==output))) == {'p0'}
    assert not file_observation(session,scope)['complete']
states.append('CAPTURE_RETRY')
after = writer.capture(factory,scope,output,lambda stream: stream.write(b'complete synthetic copy'))
assert after.read_bytes() == b'complete synthetic copy'
assert (root/identity).read_bytes() == content
with factory() as session:
    assert session.get(ManagedCopy,output).state == 'PRESENT'
    assert file_observation(session,scope)['complete']
states.append('PRESENT')
print(json.dumps({'passed':True,'fault':'kernel_tmpfs_enospc','errno':error,'capacity_bytes':capacity,
    'states':states,'source_hash':digest,'partial_registered':True,'duplicate_objects':0,
    'limits':'Dedicated tmpfs only; not host disk exhaustion, physical power loss, or 25-month acceptance.'}))
"""


def test_actual_bounded_tmpfs_enospc_preserves_intent_and_resumes(pg, tmp_path):
    if os.getenv("PHARMSHIFT_TEST_TMPFS_FAULTS") != "1":
        pytest.skip("Explicit opt-in required for isolated Docker tmpfs fault")
    # Only code and two reviewed metadata registries are copied, never repository
    # configs, staff YAML, certificates, application data or environment files.
    stage = tmp_path / "code"
    package = Path("src/shift_scheduler")
    for source in package.rglob("*.py"):
        destination = stage / source.relative_to("src")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    for name in ("storage_routes.json", "copy_schema_inventory.json"):
        shutil.copyfile(
            package / "application" / name,
            stage / "shift_scheduler" / "application" / name,
        )
    image = "pharmshift-remediation:20260922"
    image_id = subprocess.check_output(
        ["docker", "image", "inspect", image, "--format", "{{.Id}}"], text=True
    ).strip()
    assert (
        image_id
        == "sha256:c3886182046297127888af872fa7cc80874d3b47397d34461dc1257ae70a2074"
    )
    url = (
        pg.kw["bind"]
        .url.set(host="host.docker.internal")
        .render_as_string(hide_password=False)
    )
    name = "pharmshift-enospc-" + uuid4().hex[:12]
    command = [
        "docker",
        "run",
        "--rm",
        "--name",
        name,
        "--read-only",
        "--memory",
        "256m",
        "--cpus",
        "1",
        "--mount",
        "type=tmpfs,destination=/audit-managed,tmpfs-size=65536,tmpfs-mode=0700",
        "--mount",
        f"type=bind,source={stage.resolve()},destination=/audit-code,readonly",
        "--env",
        "PYTHONPATH=/audit-code",
        "--env",
        "PYTHONDONTWRITEBYTECODE=1",
        "--env",
        "PHARMSHIFT_MANAGED_STORAGE=/audit-managed",
        "--env",
        "PHARMSHIFT_ENV=development",
        "--env",
        "TEST_DATABASE_URL=" + url,
        "--entrypoint",
        "python",
        "-i",
        image,
        "-",
    ]
    try:
        result = subprocess.run(
            command, input=CONTAINER_PROGRAM, text=True, capture_output=True, timeout=90
        )
        assert result.returncode == 0, result.stderr
        evidence = json.loads(result.stdout.strip().splitlines()[-1])
        assert evidence["passed"] and evidence["errno"] == 28
        evidence["image_digest"] = image_id
        path = os.getenv("PHARMSHIFT_TMPFS_EVIDENCE")
        if path:
            with open(path, "x", encoding="utf-8") as stream:
                json.dump(evidence, stream, ensure_ascii=False, indent=2)
    finally:
        subprocess.run(
            ["docker", "rm", "--force", name], capture_output=True, timeout=15
        )
