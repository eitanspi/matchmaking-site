"""WSGI entry point for PythonAnywhere / mod_wsgi style hosts.

On PythonAnywhere: set the web app's WSGI file to import `application` from here,
or paste:

    import sys
    path = '/home/<username>/matchmaking-site'
    if path not in sys.path:
        sys.path.insert(0, path)
    from wsgi import application
"""
import os
import sys

PROJECT_DIR = os.path.abspath(os.path.dirname(__file__))
if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

from app import app as application  # noqa: E402
