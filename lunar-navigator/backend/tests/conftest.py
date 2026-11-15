"""Tests never reach NASA's servers: remote LOLA reading is off unless a test turns it on."""
import os

os.environ["LOLA_REMOTE"] = "0"
