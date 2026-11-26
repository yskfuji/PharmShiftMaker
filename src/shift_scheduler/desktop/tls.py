"""Per-install CA and the 127.0.0.1 server certificate.

The CA private key exists only in memory during issuance and is never written,
so no further certificate can be issued under this CA. The shell pins the CA
public key (it verifies the leaf signature itself, see docs/desktop/m0-verification.md).
"""

from __future__ import annotations

import datetime
import ipaddress
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from shift_scheduler.desktop.secrets import write_private

CA_DAYS = 3650
LEAF_DAYS = 825


def _name(common: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common)])


def issue(now: datetime.datetime | None = None) -> tuple[bytes, bytes, bytes]:
    """Return (ca_pem, leaf_pem, leaf_key_pem); the CA key is discarded."""
    now = now or datetime.datetime.now(datetime.UTC)
    start = now - datetime.timedelta(minutes=5)
    ca_key = ec.generate_private_key(ec.SECP256R1())
    ca_name = _name("PharmShiftMaker local CA")
    ca = (
        x509.CertificateBuilder()
        .subject_name(ca_name)
        .issuer_name(ca_name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(start)
        .not_valid_after(now + datetime.timedelta(days=CA_DAYS))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=False,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )
    leaf_key = ec.generate_private_key(ec.SECP256R1())
    leaf = (
        x509.CertificateBuilder()
        .subject_name(_name("127.0.0.1"))
        .issuer_name(ca_name)
        .public_key(leaf_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(start)
        .not_valid_after(now + datetime.timedelta(days=LEAF_DAYS))
        .add_extension(
            x509.SubjectAlternativeName(
                [x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
            ),
            critical=False,
        )
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False
        )
        .sign(ca_key, hashes.SHA256())
    )
    del ca_key
    pem = serialization.Encoding.PEM
    return (
        ca.public_bytes(pem),
        leaf.public_bytes(pem),
        leaf_key.private_bytes(
            pem, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        ),
    )


def ensure(ca_path: Path, cert_path: Path, key_path: Path) -> None:
    """Issue once. A partial set (e.g. interrupted first run) is reissued whole."""
    present = [path.exists() for path in (ca_path, cert_path, key_path)]
    if all(present):
        return
    for path in (ca_path, cert_path, key_path):
        if path.exists():
            path.unlink()
    ca_pem, leaf_pem, key_pem = issue()
    write_private(key_path, key_pem)
    write_private(cert_path, leaf_pem)
    write_private(ca_path, ca_pem)


def leaf_expires_within(cert_path: Path, days: int) -> bool:
    leaf = x509.load_pem_x509_certificate(cert_path.read_bytes())
    remaining = leaf.not_valid_after_utc - datetime.datetime.now(datetime.UTC)
    return remaining < datetime.timedelta(days=days)
