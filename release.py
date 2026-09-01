#!/usr/bin/env python3
"""Prepare, publish, and recover a TokenLedger GitHub Release."""

from __future__ import annotations

import argparse
import hashlib
import json
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from scripts import token_ledger_release as notes


ROOT = Path(__file__).resolve().parent
STATE_ROOT = ROOT / ".release-state"
EXPECTED_REPO = "iohao/token-ledger"
STAGES = ("prepared", "tag-pushed")


class ReleaseError(RuntimeError):
    """Raised when a release cannot safely continue."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(
    args: list[str],
    *,
    cwd: Path = ROOT,
    capture: bool = False,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    print(f"+ {shlex.join(args)}", flush=True)
    try:
        result = subprocess.run(args, cwd=cwd, text=True, capture_output=capture, check=False)
    except FileNotFoundError as exc:
        raise ReleaseError(f"Required command not found: {args[0]}") from exc
    if check and result.returncode != 0:
        details = (result.stderr or result.stdout or "").strip()
        suffix = f": {details}" if details else ""
        raise ReleaseError(f"Command failed ({result.returncode}): {shlex.join(args)}{suffix}")
    return result


def output(args: list[str], *, cwd: Path = ROOT, check: bool = True) -> str:
    return run(args, cwd=cwd, capture=True, check=check).stdout.strip()


def git(root: Path, *args: str, check: bool = True) -> str:
    return output(["git", *args], cwd=root, check=check)


def json_output(args: list[str], *, cwd: Path = ROOT) -> Any:
    try:
        return json.loads(output(args, cwd=cwd))
    except json.JSONDecodeError as exc:
        raise ReleaseError(f"Command did not return JSON: {shlex.join(args)}") from exc


@dataclass(frozen=True)
class ReleaseContext:
    root: Path
    repo: str
    version: str
    tag: str
    head: str


class StateStore:
    def __init__(self, tag: str):
        self.directory = STATE_ROOT / tag
        self.path = self.directory / "state.json"

    def load(self) -> dict[str, Any]:
        if not self.path.is_file():
            raise ReleaseError(f"Release state not found: {self.path}")
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ReleaseError(f"Cannot read release state {self.path}: {exc}") from exc

    def save(self, state: dict[str, Any]) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        state["updated_at"] = utc_now()
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(state, indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
        )
        temporary.replace(self.path)


def require_commands() -> None:
    missing = [name for name in ("git", "gh", "python3") if not shutil.which(name)]
    if missing:
        raise ReleaseError(f"Required commands not found: {', '.join(missing)}")
    if sys.version_info < (3, 11):
        raise ReleaseError("Python 3.11 or newer is required")


def assert_clean_main(root: Path) -> tuple[str, str]:
    if git(root, "rev-parse", "--is-inside-work-tree") != "true":
        raise ReleaseError(f"Not a Git repository: {root}")
    if git(root, "rev-parse", "--abbrev-ref", "HEAD") != "main":
        raise ReleaseError("Release publishing must run from the main branch")
    if git(root, "status", "--porcelain"):
        raise ReleaseError("Working tree must be clean before release preparation")
    run(["git", "fetch", "origin", "--tags"], cwd=root)
    head = git(root, "rev-parse", "HEAD")
    origin_main = git(root, "rev-parse", "origin/main")
    if head != origin_main:
        raise ReleaseError("Local HEAD must match origin/main before release preparation")
    return head, origin_main


def assert_github_access(root: Path, repo: str) -> None:
    if repo != EXPECTED_REPO:
        raise ReleaseError(f"origin must resolve to {EXPECTED_REPO}, found {repo}")
    result = run(["gh", "auth", "status"], cwd=root, capture=True, check=False)
    if result.returncode != 0:
        raise ReleaseError("GitHub CLI authentication is invalid")
    details = json_output(
        ["gh", "repo", "view", repo, "--json", "nameWithOwner,visibility"], cwd=root
    )
    if details.get("nameWithOwner") != repo:
        raise ReleaseError(f"GitHub CLI cannot verify repository {repo}")
    if str(details.get("visibility", "")).upper() != "PUBLIC":
        raise ReleaseError(f"Repository {repo} must be public before publishing user downloads")


def github_release_exists(root: Path, repo: str, tag: str) -> bool:
    result = run(
        ["gh", "release", "view", tag, "--repo", repo],
        cwd=root,
        capture=True,
        check=False,
    )
    return result.returncode == 0


def tag_exists(root: Path, tag: str) -> bool:
    return bool(git(root, "rev-parse", "-q", "--verify", f"refs/tags/{tag}", check=False))


def preflight(root: Path, *, allow_existing: bool = False) -> ReleaseContext:
    require_commands()
    head, _ = assert_clean_main(root)
    repo = notes.repo_from_origin(root)
    assert_github_access(root, repo)
    version = notes.read_versions(root)
    tag = notes.tag_for(version)
    if not allow_existing and (tag_exists(root, tag) or github_release_exists(root, repo, tag)):
        raise ReleaseError(f"Release {tag} already exists locally or on GitHub")
    return ReleaseContext(root=root, repo=repo, version=version, tag=tag, head=head)


def set_version(root: Path, version: str) -> dict[str, str]:
    require_commands()
    assert_clean_main(root)
    repo = notes.repo_from_origin(root)
    assert_github_access(root, repo)
    tag = notes.tag_for(version)
    if tag_exists(root, tag) or github_release_exists(root, repo, tag):
        raise ReleaseError(f"Release {tag} already exists locally or on GitHub")
    updated = notes.set_versions(root, version)
    print(f"Updated TokenLedger version to {version} in:")
    for path in updated:
        print(f"- {path}")
    return updated


def create_state(context: ReleaseContext) -> dict[str, Any]:
    store = StateStore(context.tag)
    facts_path = store.directory / "facts.json"
    draft_path = store.directory / "draft.md"
    notes_path = store.directory / "release-notes.md"
    facts = notes.build_facts(context.root, context.repo, context.version)
    draft = notes.render_draft(facts)
    notes.write_json(facts_path, facts)
    notes.write_text(draft_path, draft)
    notes.write_text(notes_path, draft)
    state: dict[str, Any] = {
        "version": context.version,
        "tag": context.tag,
        "repo": context.repo,
        "head": context.head,
        "previous_tag": facts["previous_tag"],
        "facts_file": str(facts_path),
        "draft_file": str(draft_path),
        "notes_file": str(notes_path),
        "notes_sha256": None,
        "created_at": utc_now(),
        "stages": {stage: stage == "prepared" for stage in STAGES},
    }
    store.save(state)
    return state


def prepare(root: Path) -> dict[str, Any]:
    context = preflight(root)
    store = StateStore(context.tag)
    if store.path.exists():
        existing = store.load()
        if existing.get("stages", {}).get("tag-pushed"):
            raise ReleaseError(f"Tag {context.tag} is already published")
        if existing.get("head") != context.head:
            raise ReleaseError(f"Release state for {context.tag} was prepared from another commit")
    state = create_state(context)
    print(f"\nPrepared TokenLedger {context.tag}.")
    print(f"Release facts: {state['facts_file']}")
    print(f"Release Notes: {state['notes_file']}\n")
    print(Path(state["notes_file"]).read_text(encoding="utf-8"))
    return state


def load_facts(state: dict[str, Any]) -> dict[str, Any]:
    try:
        return json.loads(Path(state["facts_file"]).read_text(encoding="utf-8"))
    except (KeyError, OSError, json.JSONDecodeError) as exc:
        raise ReleaseError("Cannot load prepared release facts") from exc


def validate_state_before_publish(root: Path, state: dict[str, Any]) -> ReleaseContext:
    context = preflight(root, allow_existing=True)
    if context.version != state.get("version") or context.repo != state.get("repo"):
        raise ReleaseError("Prepared release state does not match the current repository version")
    if context.head != state.get("head"):
        raise ReleaseError("HEAD changed after release preparation")
    if context.tag != state.get("tag"):
        raise ReleaseError("Prepared release tag does not match the current version")
    return context


def context_from_pushed_tag(root: Path, state: dict[str, Any]) -> ReleaseContext:
    """Validate immutable state after the tag has left the local checkout."""
    require_commands()
    repo = notes.repo_from_origin(root)
    if repo != state.get("repo"):
        raise ReleaseError("Prepared release state belongs to another GitHub repository")
    assert_github_access(root, repo)
    version = state.get("version")
    tag = state.get("tag")
    head = state.get("head")
    if not all(isinstance(value, str) for value in (version, tag, head)):
        raise ReleaseError("Release state is missing immutable version or commit data")
    assert isinstance(version, str) and isinstance(tag, str) and isinstance(head, str)
    if notes.tag_for(version) != tag:
        raise ReleaseError("Release state tag does not match its version")
    validate_remote_tag(root, tag, head)
    return ReleaseContext(root=root, repo=repo, version=version, tag=tag, head=head)


def validate_remote_tag(root: Path, tag: str, expected_head: str) -> None:
    run(["git", "fetch", "origin", "--tags"], cwd=root)
    actual = git(root, "rev-parse", f"{tag}^{{}}", check=False)
    if actual != expected_head:
        raise ReleaseError(
            f"Tag {tag} must point to prepared HEAD {expected_head}, found {actual or 'missing'}"
        )


def lock_release_notes(state: dict[str, Any]) -> None:
    notes_path = Path(state["notes_file"])
    current_hash = sha256(notes_path)
    if state.get("notes_sha256"):
        if state["notes_sha256"] != current_hash:
            raise ReleaseError("Release Notes changed after publishing started")
        return
    state["notes_sha256"] = current_hash


def validate_reviewed_notes(state: dict[str, Any]) -> str:
    facts = load_facts(state)
    notes_path = Path(state["notes_file"])
    try:
        content = notes_path.read_text(encoding="utf-8")
        notes.validate_notes(content, facts)
    except (OSError, notes.ReleaseNotesError) as exc:
        raise ReleaseError(str(exc)) from exc
    return content


def validate_prepared_notes(root: Path, version: str | None) -> str:
    selected_version = version or notes.read_versions(root)
    state = StateStore(notes.tag_for(selected_version)).load()
    validate_state_before_publish(root, state)
    content = validate_reviewed_notes(state)
    print(f"Validated Release Notes for {state['tag']}")
    return content


def reconstruct_state(root: Path, version: str) -> dict[str, Any]:
    """Recover local state from an immutable annotated remote tag."""
    require_commands()
    repo = notes.repo_from_origin(root)
    assert_github_access(root, repo)
    tag = notes.tag_for(version)
    run(["git", "fetch", "origin", "--tags"], cwd=root)
    if not tag_exists(root, tag):
        raise ReleaseError(f"Cannot recover {tag}: the remote tag does not exist")
    if git(root, "cat-file", "-t", f"refs/tags/{tag}") != "tag":
        raise ReleaseError(f"Cannot recover {tag}: it is not an annotated tag")
    head = git(root, "rev-parse", f"{tag}^{{}}")
    release_notes = git(root, "for-each-ref", "--format=%(contents)", f"refs/tags/{tag}") + "\n"
    facts = notes.build_facts(root, repo, version, current_ref=tag)
    try:
        notes.validate_notes(release_notes, facts)
    except notes.ReleaseNotesError as exc:
        raise ReleaseError(f"Cannot recover {tag}: {exc}") from exc
    store = StateStore(tag)
    facts_path = store.directory / "facts.json"
    draft_path = store.directory / "draft.md"
    notes_path = store.directory / "release-notes.md"
    notes.write_json(facts_path, facts)
    notes.write_text(draft_path, notes.render_draft(facts))
    notes.write_text(notes_path, release_notes)
    state: dict[str, Any] = {
        "version": version,
        "tag": tag,
        "repo": repo,
        "head": head,
        "previous_tag": facts["previous_tag"],
        "facts_file": str(facts_path),
        "draft_file": str(draft_path),
        "notes_file": str(notes_path),
        "notes_sha256": sha256(notes_path),
        "created_at": utc_now(),
        "recovered": True,
        "stages": {"prepared": True, "tag-pushed": True},
    }
    store.save(state)
    return state


def validate_existing_annotated_tag(
    root: Path, tag: str, expected_head: str, expected_notes: str
) -> None:
    if not tag_exists(root, tag):
        return
    if git(root, "cat-file", "-t", f"refs/tags/{tag}") != "tag":
        raise ReleaseError(f"Existing {tag} must be an annotated tag")
    if git(root, "rev-parse", f"{tag}^{{}}") != expected_head:
        raise ReleaseError(f"Existing {tag} does not point to prepared HEAD {expected_head}")
    content = git(root, "for-each-ref", "--format=%(contents)", f"refs/tags/{tag}")
    expected_lines = expected_notes.strip().splitlines()
    expected_heading = f"# TokenLedger {tag}"
    expected_body = "\n".join(expected_lines[1:]).strip() if expected_lines else ""
    heading_was_stripped = (
        bool(expected_lines)
        and expected_lines[0] == expected_heading
        and content.strip() == expected_body
    )
    if content.strip() != expected_notes.strip() and not heading_was_stripped:
        raise ReleaseError(f"Existing {tag} has different Release Notes")


def create_and_push_tag(
    context: ReleaseContext, state: dict[str, Any], release_notes: str
) -> None:
    """Create the annotated tag from the reviewed file, then publish only that tag."""
    notes_path = Path(state["notes_file"])
    validate_existing_annotated_tag(context.root, context.tag, context.head, release_notes)
    if not tag_exists(context.root, context.tag):
        run(
            ["git", "tag", "-a", "--cleanup=verbatim", context.tag, "-F", str(notes_path)],
            cwd=context.root,
        )
    run(["git", "push", "origin", context.tag], cwd=context.root)
    validate_remote_tag(context.root, context.tag, context.head)


def publish(root: Path, version: str | None, *, resume: bool = False) -> dict[str, Any]:
    selected_version = version or notes.read_versions(root)
    tag = notes.tag_for(selected_version)
    store = StateStore(tag)
    try:
        state = store.load()
    except ReleaseError:
        if not resume:
            raise
        state = reconstruct_state(root, selected_version)
    if state.get("stages", {}).get("tag-pushed"):
        context = context_from_pushed_tag(root, state)
    else:
        context = validate_state_before_publish(root, state)
    release_notes = validate_reviewed_notes(state)
    lock_release_notes(state)
    store.save(state)

    if not state["stages"].get("tag-pushed"):
        create_and_push_tag(context, state, release_notes)
        state["stages"]["tag-pushed"] = True
        store.save(state)
    else:
        validate_existing_annotated_tag(root, context.tag, context.head, release_notes)
        validate_remote_tag(root, context.tag, context.head)
    release_url = f"https://github.com/{context.repo}/releases/tag/{context.tag}"
    actions_url = f"https://github.com/{context.repo}/actions/workflows/release.yml"
    print(f"Pushed {context.tag}; GitHub Actions will publish the release asynchronously.")
    print(f"Release: {release_url}")
    print(f"Actions: {actions_url}")
    return state


def show_status(root: Path, version: str | None) -> None:
    selected_version = version or notes.read_versions(root)
    state = StateStore(notes.tag_for(selected_version)).load()
    observed: dict[str, Any] = {}
    try:
        repo = notes.repo_from_origin(root)
        tag = state["tag"]
        run(["git", "fetch", "origin", "--tags"], cwd=root)
        observed["tag_head"] = git(root, "rev-parse", f"{tag}^{{}}", check=False) or None
        release = run(
            ["gh", "release", "view", tag, "--repo", repo, "--json", "isDraft,isPrerelease,url"],
            cwd=root,
            capture=True,
            check=False,
        )
        observed["release"] = json.loads(release.stdout) if release.returncode == 0 else None
    except (ReleaseError, OSError, json.JSONDecodeError) as exc:
        observed["error"] = str(exc)
    print(json.dumps({"state": state, "observed": observed}, indent=2, ensure_ascii=True))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Publish a reviewed TokenLedger GitHub Release")
    subparsers = parser.add_subparsers(dest="command", required=True)
    set_version_parser = subparsers.add_parser(
        "set-version", help="update the tracked TokenLedger application version"
    )
    set_version_parser.add_argument("--version", required=True)
    subparsers.add_parser("prepare", help="run preflight and generate release facts and notes")

    validate_parser = subparsers.add_parser(
        "validate-notes", help="validate prepared Release Notes without publishing"
    )
    validate_parser.add_argument("--version")

    publish_parser = subparsers.add_parser(
        "publish", help="push a prepared release tag without waiting for GitHub Actions"
    )
    publish_parser.add_argument("--version")

    resume_parser = subparsers.add_parser("resume", help="resume publishing a prepared release tag")
    resume_parser.add_argument("--version")

    status_parser = subparsers.add_parser("status", help="show persisted release state")
    status_parser.add_argument("--version")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.command == "set-version":
            set_version(ROOT, args.version)
        elif args.command == "prepare":
            prepare(ROOT)
        elif args.command == "validate-notes":
            validate_prepared_notes(ROOT, args.version)
        elif args.command == "publish":
            publish(ROOT, args.version)
        elif args.command == "resume":
            publish(ROOT, args.version, resume=True)
        elif args.command == "status":
            show_status(ROOT, args.version)
        return 0
    except (ReleaseError, notes.ReleaseNotesError, OSError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
