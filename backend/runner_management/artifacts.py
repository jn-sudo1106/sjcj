"""Build and verify signed, digest-addressed ZIP releases."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import zipfile
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey


class ArtifactStore:
    # ZIP entries otherwise inherit the current wall-clock time. That makes the
    # archive (and therefore its sha256 release id) change on every publish even
    # when all source files and the manifest are identical.
    ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        key_path = root / "signing-key.pem"
        if key_path.exists():
            self.private_key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
        else:
            self.private_key = Ed25519PrivateKey.generate()
            key_path.write_bytes(self.private_key.private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            ))
            if os.name != "nt":
                key_path.chmod(0o600)

    @property
    def public_key(self) -> str:
        raw = self.private_key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw,
        )
        return base64.b64encode(raw).decode("ascii")

    def publish(self, files: dict[str, bytes], manifest: dict) -> tuple[str, str]:
        content = io.BytesIO()
        with zipfile.ZipFile(content, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, data in sorted(files.items()):
                if not name or name.startswith("/") or ".." in Path(name).parts or "\\" in name:
                    raise ValueError("制品文件路径无效")
                archive.writestr(self._zip_info(name), data)
            manifest_data = json.dumps(
                manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            ).encode("utf-8")
            archive.writestr(self._zip_info("manifest.json"), manifest_data)
        data = content.getvalue()
        hexdigest = hashlib.sha256(data).hexdigest()
        signature = base64.b64encode(self.private_key.sign(bytes.fromhex(hexdigest))).decode("ascii")
        path = self.root / f"{hexdigest}.zip"
        if not path.exists():
            path.write_bytes(data)
        return f"sha256:{hexdigest}", signature

    @classmethod
    def _zip_info(cls, name: str) -> zipfile.ZipInfo:
        info = zipfile.ZipInfo(name, cls.ZIP_TIMESTAMP)
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = (0o100644 & 0xFFFF) << 16
        return info

    def read(self, digest: str) -> bytes:
        if not digest.startswith("sha256:") or len(digest) != 71:
            raise ValueError("制品摘要无效")
        hex_digest = digest[7:]
        if any(ch not in "0123456789abcdef" for ch in hex_digest):
            raise ValueError("制品摘要无效")
        data = (self.root / f"{hex_digest}.zip").read_bytes()
        if hashlib.sha256(data).hexdigest() != hex_digest:
            raise ValueError("制品内容与摘要不一致")
        return data


def verify_artifact(data: bytes, digest: str, signature: str, public_key: str) -> None:
    hex_digest = hashlib.sha256(data).hexdigest()
    if digest != f"sha256:{hex_digest}":
        raise ValueError("制品摘要校验失败")
    key = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key, validate=True))
    key.verify(base64.b64decode(signature, validate=True), bytes.fromhex(hex_digest))


def extract_verified(data: bytes, target: Path) -> dict:
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for info in archive.infolist():
            name = info.filename
            destination = (target / name).resolve()
            if (not name or name.startswith("/") or "\\" in name
                    or not destination.is_relative_to(target.resolve())
                    or (info.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError("制品包含非法路径或符号链接")
            if info.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(archive.read(info))
    return json.loads((target / "manifest.json").read_text(encoding="utf-8"))


def verify_extracted(data: bytes, target: Path) -> dict:
    """Reject a local cache whose extracted code differs from the signed ZIP."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for info in archive.infolist():
            name = info.filename
            destination = (target / name).resolve()
            if not destination.is_relative_to(target.resolve()) or "\\" in name:
                raise ValueError("缓存文件路径无效")
            if info.is_dir():
                if not destination.is_dir():
                    raise ValueError("缓存目录被修改")
            elif not destination.is_file() or destination.read_bytes() != archive.read(info):
                raise ValueError("已解压的制品文件被修改")
    return json.loads((target / "manifest.json").read_text(encoding="utf-8"))
