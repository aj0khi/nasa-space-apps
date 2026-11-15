"""Tests never reach NASA's servers: the streamed LOLA DEM / PSR map are switched off unless a test opts back in."""
import pytest

from app.services import terrain


@pytest.fixture(autouse=True)
def _no_remote_lola(monkeypatch):
    monkeypatch.setattr(terrain, "REMOTE_DEM", None)
    monkeypatch.setattr(terrain, "REMOTE_PSR", None)
