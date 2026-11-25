"""Platform layer for the managed-storage file operations.

POSIX keeps the reviewed descriptor-relative calls byte for byte: every function
in the POSIX branch issues exactly the system call (flags, ``dir_fd`` and mode)
that its callers issued before this module existed.

Windows has no ``dir_fd``, ``O_NOFOLLOW`` or ``flock``. Its security model is the
"ACL lock-out" described in docs/desktop/windows-storage.md:

- the data root carries a protected DACL (inheritance disabled) that grants
  access only to the current user, SYSTEM and BUILTIN\\Administrators;
- links and reparse points (symbolic links, junctions, mount points) are refused
  in every path component before opening, and the opened file's identity is
  compared with the path afterwards;
- attacks by the same OS user, an administrator or SYSTEM are out of scope.

A ``Directory`` is a descriptor on POSIX. On Windows it is a checked absolute
path plus the identity (volume serial, file ID) it had when it was opened; every
later operation re-checks that identity and the absence of reparse points.

Command line (the desktop shell runs this once, before the first start)::

    python -m shift_scheduler.ops.platform_fs prepare-data-dir <absolute path>
"""

from __future__ import annotations

import argparse
import json
import os
import stat
import sys
from pathlib import Path
from typing import Any

if sys.platform == "win32":  # pragma: no cover - measured by the Windows CI job
    import ctypes
    import errno
    import msvcrt
    import ntpath
    import re
    from ctypes import wintypes
    from dataclasses import dataclass

    # Windows opens below always refuse links, so the POSIX flags become no-ops.
    O_NOFOLLOW = 0
    O_DIRECTORY = 0
    O_NONBLOCK = 0

    SYSTEM_SID = "S-1-5-18"
    ADMINISTRATORS_SID = "S-1-5-32-544"

    _SE_FILE_OBJECT = 1
    _OWNER_SECURITY_INFORMATION = 0x00000001
    _DACL_SECURITY_INFORMATION = 0x00000004
    _PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000
    _SE_DACL_PRESENT = 0x0004
    _SE_DACL_PROTECTED = 0x1000
    _ACCESS_ALLOWED_ACE_TYPE = 0
    _ACCESS_DENIED_ACE_TYPE = 1
    _ACL_SIZE_INFORMATION_CLASS = 2
    _TOKEN_QUERY = 0x0008
    _TOKEN_USER_CLASS = 1
    _SDDL_REVISION_1 = 1
    _DRIVE_FIXED = 3
    _DRIVE_REMOTE = 4
    _LOCKFILE_FAIL_IMMEDIATELY = 0x00000001
    _LOCKFILE_EXCLUSIVE_LOCK = 0x00000002
    _ERROR_LOCK_VIOLATION = 33
    _ERROR_IO_PENDING = 997

    _SHARE = "Desktop managed storage must be on this PC, not a share"
    _FIXED = "Desktop managed storage must be on a fixed drive of this PC"
    _LINK = "Desktop managed storage must not go through a link"
    _MISSING = "Desktop managed storage must be an existing directory"
    _OWNER = "Desktop managed storage must belong to this user"
    _PRIVATE = "Desktop managed storage must be private to this user"

    class _Overlapped(ctypes.Structure):
        _fields_ = [
            ("Internal", ctypes.c_size_t),
            ("InternalHigh", ctypes.c_size_t),
            ("Offset", wintypes.DWORD),
            ("OffsetHigh", wintypes.DWORD),
            ("hEvent", wintypes.HANDLE),
        ]

    class _AclSizeInformation(ctypes.Structure):
        _fields_ = [
            ("AceCount", wintypes.DWORD),
            ("AclBytesInUse", wintypes.DWORD),
            ("AclBytesFree", wintypes.DWORD),
        ]

    class _AceHeader(ctypes.Structure):
        _fields_ = [
            ("AceType", wintypes.BYTE),
            ("AceFlags", wintypes.BYTE),
            ("AceSize", wintypes.WORD),
        ]

    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    _PVOID = ctypes.c_void_p
    _PPVOID = ctypes.POINTER(ctypes.c_void_p)

    def _function(
        library: ctypes.WinDLL, name: str, restype: Any, *argtypes: Any
    ) -> ctypes._NamedFuncPointer:
        function = library[name]
        function.restype = restype
        function.argtypes = argtypes
        return function

    _LockFileEx = _function(
        _kernel32,
        "LockFileEx",
        wintypes.BOOL,
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.POINTER(_Overlapped),
    )
    _UnlockFileEx = _function(
        _kernel32,
        "UnlockFileEx",
        wintypes.BOOL,
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.POINTER(_Overlapped),
    )
    _GetDriveTypeW = _function(
        _kernel32, "GetDriveTypeW", wintypes.UINT, wintypes.LPCWSTR
    )
    _LocalFree = _function(_kernel32, "LocalFree", _PVOID, _PVOID)
    _GetCurrentProcess = _function(_kernel32, "GetCurrentProcess", wintypes.HANDLE)
    _CloseHandle = _function(_kernel32, "CloseHandle", wintypes.BOOL, wintypes.HANDLE)
    _OpenProcessToken = _function(
        _advapi32,
        "OpenProcessToken",
        wintypes.BOOL,
        wintypes.HANDLE,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.HANDLE),
    )
    _GetTokenInformation = _function(
        _advapi32,
        "GetTokenInformation",
        wintypes.BOOL,
        wintypes.HANDLE,
        ctypes.c_int,
        _PVOID,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    )
    _ConvertSidToStringSidW = _function(
        _advapi32, "ConvertSidToStringSidW", wintypes.BOOL, _PVOID, _PPVOID
    )
    _GetNamedSecurityInfoW = _function(
        _advapi32,
        "GetNamedSecurityInfoW",
        wintypes.DWORD,
        wintypes.LPCWSTR,
        ctypes.c_int,
        wintypes.DWORD,
        _PPVOID,
        _PPVOID,
        _PPVOID,
        _PPVOID,
        _PPVOID,
    )
    _GetSecurityDescriptorControl = _function(
        _advapi32,
        "GetSecurityDescriptorControl",
        wintypes.BOOL,
        _PVOID,
        ctypes.POINTER(wintypes.WORD),
        ctypes.POINTER(wintypes.DWORD),
    )
    _GetAclInformation = _function(
        _advapi32,
        "GetAclInformation",
        wintypes.BOOL,
        _PVOID,
        _PVOID,
        wintypes.DWORD,
        ctypes.c_int,
    )
    _GetAce = _function(
        _advapi32, "GetAce", wintypes.BOOL, _PVOID, wintypes.DWORD, _PPVOID
    )
    _ConvertStringSecurityDescriptorToSecurityDescriptorW = _function(
        _advapi32,
        "ConvertStringSecurityDescriptorToSecurityDescriptorW",
        wintypes.BOOL,
        wintypes.LPCWSTR,
        wintypes.DWORD,
        _PPVOID,
        ctypes.POINTER(wintypes.ULONG),
    )
    _GetSecurityDescriptorDacl = _function(
        _advapi32,
        "GetSecurityDescriptorDacl",
        wintypes.BOOL,
        _PVOID,
        ctypes.POINTER(wintypes.BOOL),
        _PPVOID,
        ctypes.POINTER(wintypes.BOOL),
    )
    _SetNamedSecurityInfoW = _function(
        _advapi32,
        "SetNamedSecurityInfoW",
        wintypes.DWORD,
        wintypes.LPWSTR,
        ctypes.c_int,
        wintypes.DWORD,
        _PVOID,
        _PVOID,
        _PVOID,
        _PVOID,
    )

    def _last_error() -> OSError:
        return ctypes.WinError(ctypes.get_last_error())

    # --- exclusive locks -----------------------------------------------------

    def lock_exclusive(fd: int, *, blocking: bool) -> None:
        """LockFileEx on the first byte; non-blocking failure is BlockingIOError."""
        flags = _LOCKFILE_EXCLUSIVE_LOCK | (
            0 if blocking else _LOCKFILE_FAIL_IMMEDIATELY
        )
        overlapped = _Overlapped()
        handle = msvcrt.get_osfhandle(fd)
        if not _LockFileEx(handle, flags, 0, 1, 0, ctypes.byref(overlapped)):
            error = ctypes.get_last_error()
            if not blocking and error in (_ERROR_LOCK_VIOLATION, _ERROR_IO_PENDING):
                raise BlockingIOError(errno.EAGAIN, "File lock is held elsewhere")
            raise ctypes.WinError(error)

    def unlock(fd: int) -> None:
        """Release before close; closing the handle alone may release it late."""
        overlapped = _Overlapped()
        _UnlockFileEx(msvcrt.get_osfhandle(fd), 0, 1, 0, ctypes.byref(overlapped))

    # --- security identifiers and DACLs --------------------------------------

    def _sid_string(sid: int | None) -> str:
        text = ctypes.c_void_p()
        if not sid or not _ConvertSidToStringSidW(sid, ctypes.byref(text)):
            raise _last_error()
        try:
            if text.value is None:
                raise OSError(errno.EINVAL, "SID could not be converted")
            return ctypes.wstring_at(text.value)
        finally:
            _LocalFree(text)

    def current_user_sid() -> str:
        """String SID of the user that owns this process token."""
        token = wintypes.HANDLE()
        if not _OpenProcessToken(
            _GetCurrentProcess(), _TOKEN_QUERY, ctypes.byref(token)
        ):
            raise _last_error()
        try:
            needed = wintypes.DWORD()
            _GetTokenInformation(
                token, _TOKEN_USER_CLASS, None, 0, ctypes.byref(needed)
            )
            buffer = ctypes.create_string_buffer(needed.value)
            if not _GetTokenInformation(
                token, _TOKEN_USER_CLASS, buffer, needed, ctypes.byref(needed)
            ):
                raise _last_error()
            # TOKEN_USER starts with SID_AND_ATTRIBUTES whose first field is the SID.
            return _sid_string(ctypes.c_void_p.from_buffer(buffer).value)
        finally:
            _CloseHandle(token)

    @dataclass(frozen=True)
    class AccessEntry:
        kind: int
        flags: int
        mask: int
        sid: str

    @dataclass(frozen=True)
    class SecurityState:
        owner: str
        has_dacl: bool
        protected: bool
        entries: tuple[AccessEntry, ...]

    def security_state(path: str) -> SecurityState:
        """Owner and DACL of ``path`` as read by GetNamedSecurityInfoW."""
        owner, dacl, descriptor = (
            ctypes.c_void_p(),
            ctypes.c_void_p(),
            ctypes.c_void_p(),
        )
        code = _GetNamedSecurityInfoW(
            path,
            _SE_FILE_OBJECT,
            _OWNER_SECURITY_INFORMATION | _DACL_SECURITY_INFORMATION,
            ctypes.byref(owner),
            None,
            ctypes.byref(dacl),
            None,
            ctypes.byref(descriptor),
        )
        if code:
            raise ctypes.WinError(code)
        try:
            control, revision = wintypes.WORD(), wintypes.DWORD()
            if not _GetSecurityDescriptorControl(
                descriptor, ctypes.byref(control), ctypes.byref(revision)
            ):
                raise _last_error()
            entries: list[AccessEntry] = []
            if dacl.value:
                size = _AclSizeInformation()
                if not _GetAclInformation(
                    dacl,
                    ctypes.byref(size),
                    ctypes.sizeof(size),
                    _ACL_SIZE_INFORMATION_CLASS,
                ):
                    raise _last_error()
                for index in range(size.AceCount):
                    ace = ctypes.c_void_p()
                    if not _GetAce(dacl, index, ctypes.byref(ace)) or not ace.value:
                        raise _last_error()
                    header = _AceHeader.from_address(ace.value)
                    kind = int(header.AceType)
                    # ACCESS_ALLOWED_ACE / ACCESS_DENIED_ACE: header, Mask, SidStart.
                    known = kind in (_ACCESS_ALLOWED_ACE_TYPE, _ACCESS_DENIED_ACE_TYPE)
                    entries.append(
                        AccessEntry(
                            kind=kind,
                            flags=int(header.AceFlags),
                            mask=wintypes.DWORD.from_address(ace.value + 4).value,
                            sid=_sid_string(ace.value + 8) if known else "",
                        )
                    )
            return SecurityState(
                owner=_sid_string(owner.value) if owner.value else "",
                has_dacl=bool(dacl.value) and bool(control.value & _SE_DACL_PRESENT),
                protected=bool(control.value & _SE_DACL_PROTECTED),
                entries=tuple(entries),
            )
        finally:
            _LocalFree(descriptor)

    def dacl_problems(path: str, *, require_protected: bool) -> list[str]:
        """Deviations from the ACL lock-out model; empty when ``path`` complies.

        Allow entries may name only the current user, SYSTEM and Administrators.
        Deny entries only restrict and are accepted. Any other entry type (object,
        callback, compound) is refused rather than interpreted. The data root
        must also be protected (no inherited entries) and grant the user access.
        """
        user = current_user_sid()
        allowed = {user, SYSTEM_SID, ADMINISTRATORS_SID}
        state = security_state(path)
        problems: list[str] = []
        if state.owner not in allowed:
            problems.append(f"owner {state.owner or 'unknown'}")
        if not state.has_dacl:
            problems.append("no DACL (everyone has access)")
        if require_protected and not state.protected:
            problems.append("DACL inherits from the parent folder")
        for entry in state.entries:
            if entry.kind == _ACCESS_DENIED_ACE_TYPE:
                continue
            if entry.kind != _ACCESS_ALLOWED_ACE_TYPE:
                problems.append(f"unsupported ACE type {entry.kind}")
            elif entry.sid not in allowed:
                problems.append(f"access granted to {entry.sid}")
        if require_protected and not any(
            e.kind == _ACCESS_ALLOWED_ACE_TYPE and e.sid == user for e in state.entries
        ):
            problems.append("the current user has no access entry")
        return problems

    def apply_private_dacl(path: str) -> None:
        """Replace the DACL with the protected user/SYSTEM/Administrators DACL."""
        sddl = (
            f"D:P(A;OICI;FA;;;{current_user_sid()})"
            f"(A;OICI;FA;;;{SYSTEM_SID})(A;OICI;FA;;;{ADMINISTRATORS_SID})"
        )
        descriptor = ctypes.c_void_p()
        if not _ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl, _SDDL_REVISION_1, ctypes.byref(descriptor), None
        ):
            raise _last_error()
        try:
            present, defaulted = wintypes.BOOL(), wintypes.BOOL()
            dacl = ctypes.c_void_p()
            if not _GetSecurityDescriptorDacl(
                descriptor,
                ctypes.byref(present),
                ctypes.byref(dacl),
                ctypes.byref(defaulted),
            ):
                raise _last_error()
            if not present.value or not dacl.value:
                raise OSError(errno.EINVAL, "Private DACL was not built", path)
            code = _SetNamedSecurityInfoW(
                path,
                _SE_FILE_OBJECT,
                _DACL_SECURITY_INFORMATION | _PROTECTED_DACL_SECURITY_INFORMATION,
                None,
                None,
                dacl,
                None,
            )
            if code:
                raise ctypes.WinError(code)
        finally:
            _LocalFree(descriptor)

    # --- links, reparse points and identities --------------------------------

    def _is_link(details: os.stat_result) -> bool:
        return stat.S_ISLNK(details.st_mode) or bool(
            details.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT
        )

    class LinkRefusedError(PermissionError):
        """A link or reparse point was found where only plain entries may be."""

    def _refused(message: str, path: str) -> OSError:
        return PermissionError(errno.EACCES, message, path)

    def _link_refused(path: str) -> OSError:
        return LinkRefusedError(errno.EACCES, "Link or reparse point refused", path)

    def _identity(details: os.stat_result) -> tuple[int, int]:
        return details.st_dev, details.st_ino

    def check_components(path: str, *, missing_ok: bool = False) -> None:
        """lstat every component from the drive root down; refuse any link.

        ``os.lstat`` reports a symbolic link, junction or mount point itself, not
        its target. A missing component raises FileNotFoundError, or ends the
        walk when ``missing_ok`` (nothing below it exists yet).
        """
        full = ntpath.abspath(path)
        drive, rest = ntpath.splitdrive(full)
        current = drive + "\\"
        for part in (p for p in rest.split("\\") if p):
            current = ntpath.join(current, part)
            try:
                details = os.lstat(current)
            except FileNotFoundError:
                if missing_ok:
                    return
                raise
            if _is_link(details):
                raise _link_refused(current)

    def is_link(path: Path) -> bool:
        """Path.is_symlink() that also treats junctions and mount points as links."""
        try:
            return _is_link(os.lstat(path))
        except (FileNotFoundError, NotADirectoryError, ValueError):
            return False  # as Path.is_symlink(); other errors propagate

    @dataclass(frozen=True)
    class Directory:
        """A checked directory path with the identity it had when opened."""

        path: str
        device: int
        inode: int

    def _directory_at(path: str) -> Directory:
        check_components(path)
        details = os.lstat(path)
        if not stat.S_ISDIR(details.st_mode):
            raise NotADirectoryError(errno.ENOTDIR, "Not a directory", path)
        return Directory(path, details.st_dev, details.st_ino)

    def _verify(directory: Directory) -> None:
        check_components(directory.path)
        details = os.lstat(directory.path)
        if not stat.S_ISDIR(details.st_mode) or _identity(details) != (
            directory.device,
            directory.inode,
        ):
            raise _refused("Directory was replaced", directory.path)

    _RESERVED = re.compile(r"(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\..*)?", re.IGNORECASE)

    def _child(directory: Directory, name: str) -> str:
        # One plain component: no separators, drive letters, streams, dot names,
        # trailing dots or spaces (Windows strips them) and no device names.
        if (
            not name
            or name in {".", ".."}
            or any(c in name for c in "\\/:")
            or name != name.rstrip(" .")
            or _RESERVED.fullmatch(name)
        ):
            raise ValueError("A single path component is required")
        _verify(directory)
        return ntpath.join(directory.path, name)

    def _open_checked(full: str, flags: int, mode: int) -> int:
        try:
            before: os.stat_result | None = os.lstat(full)
        except FileNotFoundError:
            before = None
        if before is not None and _is_link(before):
            raise _link_refused(full)
        # O_BINARY: no newline translation. os.open already adds O_NOINHERIT.
        fd = os.open(full, flags | os.O_BINARY, mode)
        try:
            opened = os.fstat(fd)
            after = os.lstat(full)
            if (
                _is_link(after)
                or _identity(opened) != _identity(after)
                or (before is not None and _identity(before) != _identity(after))
            ):
                raise _refused("File was replaced while it was opened", full)
        except BaseException:
            os.close(fd)
            raise
        return fd

    # --- the operations used by the managed-storage modules ------------------

    def open_directory(path: str | os.PathLike[str]) -> Directory:
        return _directory_at(ntpath.abspath(os.fspath(path)))

    def open_subdirectory(name: str, parent: Directory) -> Directory:
        return _directory_at(_child(parent, name))

    def duplicate_directory(directory: Directory) -> Directory:
        return directory

    def close_directory(directory: Directory) -> None:
        """Nothing is held open on Windows (see the module docstring)."""

    def open_at(
        name: str, flags: int, mode: int = 0o777, *, directory: Directory
    ) -> int:
        full = _child(directory, name)
        fd = _open_checked(full, flags, mode)
        try:
            _verify(directory)
        except BaseException:
            os.close(fd)
            raise
        return fd

    def open_path(path: str | os.PathLike[str], flags: int, mode: int = 0o777) -> int:
        full = ntpath.abspath(os.fspath(path))
        check_components(ntpath.dirname(full))
        fd = _open_checked(full, flags, mode)
        try:
            check_components(full)
        except BaseException:
            os.close(fd)
            raise
        return fd

    def stat_at(name: str, *, directory: Directory) -> os.stat_result:
        return os.lstat(_child(directory, name))

    def mkdir_at(name: str, mode: int, *, directory: Directory) -> None:
        """Create a directory that inherits the protected DACL of the data root.

        ``mode`` is deliberately not passed on. Since CPython 3.12.4 (CVE-2024-4030)
        ``os.mkdir(path, 0o700)`` installs its own protected DACL that also grants
        OWNER RIGHTS (S-1-3-4), which the ACL lock-out model does not allow.
        """
        del mode
        os.mkdir(_child(directory, name))

    def link_at(source: str, target: str, *, directory: Directory) -> None:
        source_path = _child(directory, source)
        target_path = _child(directory, target)
        if _is_link(os.lstat(source_path)):
            raise _link_refused(source_path)
        os.link(source_path, target_path)  # fails when the target exists

    def rename_at(
        source: str,
        source_directory: Directory,
        target: str,
        target_directory: Directory,
    ) -> None:
        # Windows rename never replaces an existing target.
        os.rename(_child(source_directory, source), _child(target_directory, target))

    def unlink_at(name: str, *, directory: Directory) -> None:
        os.unlink(_child(directory, name))

    def fsync_directory(directory: Directory) -> None:
        """No-op: see "directory fsync" in docs/desktop/windows-storage.md."""

    def fsync_directory_path(path: str | os.PathLike[str]) -> None:
        """No-op: see "directory fsync" in docs/desktop/windows-storage.md."""

    def directory_is_private(directory: Directory) -> bool:
        _verify(directory)
        return not dacl_problems(directory.path, require_protected=False)

    # --- desktop data root ---------------------------------------------------

    def _drive_problem(full: str) -> str | None:
        drive = ntpath.splitdrive(full)[0]
        if not re.fullmatch(r"[A-Za-z]:", drive):
            # UNC, \\?\ and device paths are not a drive letter of this PC.
            return _SHARE if drive.startswith(("\\\\", "//")) else _FIXED
        kind = _GetDriveTypeW(drive + "\\")
        if kind == _DRIVE_REMOTE:
            return _SHARE
        if kind != _DRIVE_FIXED:
            return _FIXED
        return None

    def windows_path_problem(path: str) -> str | None:
        """Refuse shares, UNC and device paths, relative paths and non-fixed drives.

        Only ``X:\\...`` is accepted: Python 3.12 also calls ``\\data`` absolute
        (relative to the current drive), which is refused here.
        """
        if path.startswith(("\\\\", "//")):
            return _SHARE
        drive, rest = ntpath.splitdrive(path)
        if not re.fullmatch(r"[A-Za-z]:", drive) or not rest.startswith(("\\", "/")):
            return _MISSING
        return _drive_problem(ntpath.abspath(path))

    def windows_storage_problem(path: str) -> str | None:
        """Why ``path`` cannot be the desktop data root, or None when it can."""
        problem = windows_path_problem(path)
        if problem:
            return problem
        full = ntpath.abspath(path)
        try:
            check_components(full)
        except LinkRefusedError:
            return _LINK
        except OSError:
            return _MISSING
        if not ntpath.isdir(full):
            return _MISSING
        problems = dacl_problems(full, require_protected=True)
        if any(p.startswith("owner ") for p in problems):
            return _OWNER
        if problems:
            return f"{_PRIVATE} ({'; '.join(problems)})"
        return None

    def prepare_data_dir(path: str) -> str:
        """Create the data root if needed and apply the protected private DACL."""
        problem = windows_path_problem(path)
        if problem:
            raise RuntimeError(problem)
        full = ntpath.abspath(path)
        try:
            # Existing parents are checked before anything is created through them.
            check_components(full, missing_ok=True)
            os.makedirs(full, exist_ok=True)
            check_components(full)  # before the DACL is touched
        except LinkRefusedError as exc:
            raise RuntimeError(_LINK) from exc
        # Someone else's folder is refused before its DACL is changed.
        if security_state(full).owner not in {
            current_user_sid(),
            SYSTEM_SID,
            ADMINISTRATORS_SID,
        }:
            raise RuntimeError(_OWNER)
        apply_private_dacl(full)
        problem = windows_storage_problem(full)
        if problem:
            raise RuntimeError(problem)
        return full

else:
    import fcntl

    Directory = int

    O_NOFOLLOW = os.O_NOFOLLOW
    O_DIRECTORY = os.O_DIRECTORY
    O_NONBLOCK = os.O_NONBLOCK

    def lock_exclusive(fd: int, *, blocking: bool) -> None:
        if blocking:
            fcntl.flock(fd, fcntl.LOCK_EX)
        else:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def unlock(fd: int) -> None:
        """Nothing to do: flock is released when the descriptor is closed."""

    def is_link(path: Path) -> bool:
        return path.is_symlink()

    def open_directory(path: str | os.PathLike[str]) -> Directory:
        return os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)

    def open_subdirectory(name: str, parent: Directory) -> Directory:
        return os.open(
            name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent
        )

    def duplicate_directory(directory: Directory) -> Directory:
        return os.dup(directory)

    def close_directory(directory: Directory) -> None:
        os.close(directory)

    def open_at(
        name: str, flags: int, mode: int = 0o777, *, directory: Directory
    ) -> int:
        return os.open(name, flags, mode, dir_fd=directory)

    def open_path(path: str | os.PathLike[str], flags: int, mode: int = 0o777) -> int:
        return os.open(path, flags, mode)

    def stat_at(name: str, *, directory: Directory) -> os.stat_result:
        return os.stat(name, dir_fd=directory, follow_symlinks=False)

    def mkdir_at(name: str, mode: int, *, directory: Directory) -> None:
        os.mkdir(name, mode=mode, dir_fd=directory)

    def link_at(source: str, target: str, *, directory: Directory) -> None:
        os.link(
            source,
            target,
            src_dir_fd=directory,
            dst_dir_fd=directory,
            follow_symlinks=False,
        )

    def rename_at(
        source: str,
        source_directory: Directory,
        target: str,
        target_directory: Directory,
    ) -> None:
        os.rename(
            source, target, src_dir_fd=source_directory, dst_dir_fd=target_directory
        )

    def unlink_at(name: str, *, directory: Directory) -> None:
        os.unlink(name, dir_fd=directory)

    def fsync_directory(directory: Directory) -> None:
        os.fsync(directory)

    def fsync_directory_path(path: str | os.PathLike[str]) -> None:
        directory_fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)

    def directory_is_private(directory: Directory) -> bool:
        return not stat.S_IMODE(os.fstat(directory).st_mode) & 0o077

    def prepare_data_dir(path: str) -> str:
        """Create the data root as 0700, owned by this user, without links."""
        target = Path(path)
        if not target.is_absolute():
            raise RuntimeError("Desktop managed storage must be an absolute path")
        target.mkdir(mode=0o700, parents=True, exist_ok=True)
        if target.resolve() != target.absolute():
            raise RuntimeError("Desktop managed storage must not go through a link")
        os.chmod(target, 0o700)
        details = target.stat()
        if details.st_uid != os.getuid():
            raise RuntimeError("Desktop managed storage must belong to this user")
        if stat.S_IMODE(details.st_mode) & 0o077:
            raise RuntimeError("Desktop managed storage must be private to this user")
        return str(target)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m shift_scheduler.ops.platform_fs",
        description="Prepare the private data folder of the desktop edition.",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser(
        "prepare-data-dir",
        help="create the folder and restrict it to this user, SYSTEM and Administrators",
    )
    prepare.add_argument("path")
    arguments = parser.parse_args(argv)
    try:
        prepared = prepare_data_dir(arguments.path)
    except (OSError, RuntimeError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "path": prepared}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
