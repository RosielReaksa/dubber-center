"""Command line: user and key management, maintenance.

    python -m dubber_center.cli create-user --email you@example.com
    python -m dubber_center.cli list-users
    python -m dubber_center.cli create-key --email you@example.com --name ci
    python -m dubber_center.cli sync-models
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from dubber_center.db.base import SessionLocal


async def _run(command: str, args: argparse.Namespace) -> int:
    from dubber_center.db.base import ensure_schema

    await ensure_schema()
    return await _COMMANDS[command](args)


_COMMANDS: dict[str, object] = {}


async def _create_user(args: argparse.Namespace) -> int:
    from dubber_center.services.users import create_user_with_key

    async with SessionLocal() as session:
        user, key = await create_user_with_key(
            session,
            email=args.email,
            name=args.name,
            role=args.role,
            credits=args.credits,
        )
    print(f"user:  {user.id}  {user.email}  role={user.role}")
    print(f"key:   {key}")
    print("Store it now — it will not be shown again.")
    return 0


async def _create_key(args: argparse.Namespace) -> int:
    from dubber_center.services.users import create_key_for_email

    async with SessionLocal() as session:
        key = await create_key_for_email(session, args.email, name=args.name)
    print(f"key:   {key}")
    print("Store it now — it will not be shown again.")
    return 0


async def _list_users(_: argparse.Namespace) -> int:
    from sqlalchemy import select

    from dubber_center.db.tables import User

    async with SessionLocal() as session:
        users = (await session.scalars(select(User).order_by(User.created_at))).all()
    if not users:
        print("no users yet")
        return 0
    print(f"{'email':40} {'role':8} {'status':9} {'credits':>8}  id")
    for user in users:
        print(
            f"{user.email:40} {user.role:8} {user.status:9} "
            f"{user.credits:8.2f}  {user.id}"
        )
    return 0


async def _sync_models(_: argparse.Namespace) -> int:
    from dubber_center.registry.service import sync_manifests

    async with SessionLocal() as session:
        errors = await sync_manifests(session)
    if errors:
        for error in errors:
            print(f"skipped: {error}", file=sys.stderr)
    print(f"synced {len(errors) and 'with errors' or 'ok'}")
    return 1 if errors else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="dubber-center")
    sub = parser.add_subparsers(dest="command", required=True)

    create_user = sub.add_parser("create-user", help="create a user and print an API key")
    create_user.add_argument("--email", required=True)
    create_user.add_argument("--name")
    create_user.add_argument(
        "--role", default="user", choices=["user", "support", "admin", "owner"]
    )
    create_user.add_argument("--credits", type=float, default=0.0)
    create_user.set_defaults(func=_create_user)

    create_key = sub.add_parser("create-key", help="create another key for a user")
    create_key.add_argument("--email", required=True)
    create_key.add_argument("--name", default="default")
    create_key.set_defaults(func=_create_key)

    sub.add_parser("list-users", help="list users").set_defaults(func=_list_users)
    sub.add_parser("sync-models", help="upsert manifests into the database").set_defaults(
        func=_sync_models
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    _COMMANDS.update(
        {
            "create-user": _create_user,
            "create-key": _create_key,
            "list-users": _list_users,
            "sync-models": _sync_models,
        }
    )
    return asyncio.run(_run(args.command, args))


if __name__ == "__main__":
    raise SystemExit(main())