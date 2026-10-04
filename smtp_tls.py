import os, ssl
from pathlib import Path

def smtp_tls_context():
    context = ssl.create_default_context()
    if not os.environ.get("SSL_CERT_FILE") and not ssl.get_default_verify_paths().cafile and Path("/etc/ssl/cert.pem").is_file():
        context.load_verify_locations(cafile="/etc/ssl/cert.pem")
    return context
