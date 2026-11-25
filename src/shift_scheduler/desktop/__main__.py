import os
import sys

from shift_scheduler.desktop.launcher import main

code = main()
sys.stdout.flush()
sys.stderr.flush()
# launch() has already stopped every child. Skip interpreter finalization: the
# stdin watcher thread is blocked in a read, and finalizing would abort (SIGABRT).
os._exit(code)
