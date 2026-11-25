"""Desktop edition launcher: one PC, one OS user, everything on 127.0.0.1.

The Electron shell starts ``python -m shift_scheduler.desktop`` and waits for a
single JSON "ready" line on stdout. This package owns the data directory,
per-install secrets and TLS, the bundled PostgreSQL, and the child processes
(control authority, API, worker, web server).
"""
