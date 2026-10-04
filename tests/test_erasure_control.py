import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest

from shift_scheduler.ops.erasure_control import advance, restore_authority

KEY = b"isolated-control-key-for-tests-only-32"


def test_replay_rejects_old_manifest_and_tampered_control(tmp_path):
    advance(tmp_path, "a" * 64, KEY, 0)
    advance(tmp_path, "b" * 64, KEY, 1)
    with pytest.raises(ValueError, match="superseded"):
        with restore_authority(tmp_path, "a" * 64, KEY, 1):
            pytest.fail("Old control opened restore")
    with restore_authority(tmp_path, "b" * 64, KEY, 2):
        pass
    path = tmp_path / "current.json"
    value = json.loads(path.read_text())
    value["payload"]["generation"] = 1
    path.write_text(json.dumps(value))
    with pytest.raises(ValueError, match="signature"):
        with restore_authority(tmp_path, "b" * 64, KEY, 1):
            pytest.fail("Tampered control opened restore")


def test_control_writer_cannot_change_generation_during_restore_commit(tmp_path):
    advance(tmp_path, "a" * 64, KEY, 0)
    started, completed = Event(), Event()

    def write():
        started.set()
        advance(tmp_path, "b" * 64, KEY, 1)
        completed.set()

    with ThreadPoolExecutor() as pool:
        with restore_authority(tmp_path, "a" * 64, KEY, 1):
            future = pool.submit(write)
            assert started.wait(2)
            assert not completed.wait(0.1)
        future.result(timeout=3)
    with restore_authority(tmp_path, "b" * 64, KEY, 2):
        pass
