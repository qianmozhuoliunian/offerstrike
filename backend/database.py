import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path


SCHEMA_VERSION = 3


def default_data_dir():
    configured = os.getenv("INTERVIEW_DATA_DIR")
    if configured:
        return Path(configured)
    if os.name == "nt":
        local = Path(os.getenv("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        return local / "OfferPilot" / "web-workbench"
    return Path("data")


@contextmanager
def connect(path):
    db = sqlite3.connect(path, timeout=5, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA secure_delete = ON")
    db.execute("PRAGMA temp_store = MEMORY")
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    schema = Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")
    with connect(path) as db:
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version > SCHEMA_VERSION:
            raise RuntimeError("数据库版本高于当前程序，请使用更新版本打开")
        if version == SCHEMA_VERSION:
            return
        db.execute("BEGIN IMMEDIATE")
        # Individual statements preserve a single transaction across DDL and ALTER.
        for statement in schema.split(";"):
            if statement.strip():
                db.execute(statement)
        for table, column in (("sources", "interview_date"), ("questions", "note")):
            columns = {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}
            if column not in columns:
                db.execute(f"ALTER TABLE {table} ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
        db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
