"""Operational commands: `sonora-api create-admin --email ...`."""

import argparse
import asyncio
import getpass
import os
import sys

from sqlalchemy import select

from sonora_api.core.config import get_settings
from sonora_api.core.db import create_engine, create_sessionmaker
from sonora_api.core.ids import uuid7
from sonora_api.core.security import hash_password
from sonora_api.models import User
from sonora_api.models.enums import UserRole
from sonora_api.schemas.auth import PASSWORD_MIN
from sonora_api.services.auth import normalize_email


async def create_admin(email: str, display_name: str, password: str | None) -> str:
    settings = get_settings()
    engine = create_engine(settings)
    try:
        async with create_sessionmaker(engine)() as session:
            user = await session.scalar(select(User).where(User.email == normalize_email(email)))
            if user is not None:
                user.role = UserRole.ADMIN
                outcome = f"promoted existing user {user.email} to admin"
            else:
                if not password or len(password) < PASSWORD_MIN:
                    raise SystemExit(f"password must be at least {PASSWORD_MIN} characters")
                user = User(
                    id=uuid7(),
                    email=normalize_email(email),
                    password_hash=await hash_password(password),
                    display_name=display_name,
                    role=UserRole.ADMIN,
                )
                session.add(user)
                outcome = f"created admin {user.email}"
            await session.commit()
            return outcome
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="sonora-api")
    commands = parser.add_subparsers(dest="command", required=True)
    admin = commands.add_parser("create-admin", help="create an admin account or promote an existing user")
    admin.add_argument("--email", required=True)
    admin.add_argument("--name", default="Admin")
    args = parser.parse_args(argv)

    if args.command == "create-admin":
        # Password: env var for automation, interactive prompt otherwise (never a CLI argument).
        password = os.environ.get("SONORA_ADMIN_PASSWORD")
        if password is None and sys.stdin.isatty():
            password = getpass.getpass("Password (ignored if the user exists): ")
        print(asyncio.run(create_admin(args.email, args.name, password)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
