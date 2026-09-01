"""Deterministic facts and validation for TokenLedger releases."""

from __future__ import annotations

import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any


SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
CJK_RE = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
PLACEHOLDER_RE = re.compile(r"\b(?:TODO|TBD|PLACEHOLDER)\b", re.IGNORECASE)
CATEGORY_TITLES = {
    "features": "Features",
    "fixes": "Fixes",
    "performance": "Performance",
    "refactoring": "Refactoring",
    "documentation": "Documentation",
    "maintenance": "Maintenance",
    "other": "Other changes",
}
MACOS_FIRST_LAUNCH_NOTICE = (
    "macOS may block TokenLedger the first time you open it. After moving `TokenLedger.app` "
    "to `/Applications`, verify that it came from this official release, open Terminal, and "
    "run the following command once:"
)
MACOS_QUARANTINE_COMMAND = (
    'sudo xattr -dr com.apple.quarantine "/Applications/TokenLedger.app"'
)
CHINESE_SECTION_HEADING = "## 中文说明"


class ReleaseNotesError(RuntimeError):
    """Raised when release facts or notes are invalid."""


def run(args: list[str], *, cwd: Path, check: bool = True) -> str:
    try:
        result = subprocess.run(args, cwd=cwd, text=True, capture_output=True, check=False)
    except FileNotFoundError as exc:
        raise ReleaseNotesError(f"Required command not found: {args[0]}") from exc
    if check and result.returncode != 0:
        details = (result.stderr or result.stdout).strip() or f"exit code {result.returncode}"
        raise ReleaseNotesError(f"{' '.join(args)} failed: {details}")
    return result.stdout.strip()


def git(root: Path, *args: str, check: bool = True) -> str:
    return run(["git", *args], cwd=root, check=check)


def version_key(version: str) -> tuple[int, int, int]:
    match = SEMVER_RE.fullmatch(version)
    if not match:
        raise ReleaseNotesError(f"Version must use X.Y.Z format, found {version!r}")
    return tuple(int(value) for value in match.groups())  # type: ignore[return-value]


def tag_for(version: str) -> str:
    version_key(version)
    return f"v{version}"


def parse_tag(tag: str) -> tuple[int, int, int] | None:
    if not tag.startswith("v"):
        return None
    try:
        return version_key(tag[1:])
    except ReleaseNotesError:
        return None


def read_versions(root: Path) -> str:
    try:
        package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ReleaseNotesError(f"Cannot read package.json version: {exc}") from exc
    version = package.get("version")
    if not isinstance(version, str):
        raise ReleaseNotesError("package.json must contain a string version")
    version_key(version)
    return version


def replace_once(text: str, pattern: str, replacement: str, path: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE)
    if count != 1:
        raise ReleaseNotesError(f"Cannot locate the TokenLedger version in {path}")
    return updated


def set_versions(root: Path, version: str) -> dict[str, str]:
    target = version_key(version)
    current_version = read_versions(root)
    if target <= version_key(current_version):
        raise ReleaseNotesError(
            f"New version must be greater than {current_version}, found {version}"
        )

    path = root / "package.json"
    escaped_current = re.escape(current_version)
    updated = replace_once(
        path.read_text(encoding="utf-8"),
        rf'^(\s*"version"\s*:\s*"){escaped_current}("\s*,?)$',
        rf"\g<1>{version}\g<2>",
        "package.json",
    )
    write_text(path, updated)
    if read_versions(root) != version:
        raise ReleaseNotesError("package.json version did not update")
    return {"package.json": version}


def repo_from_origin(root: Path) -> str:
    remote = git(root, "remote", "get-url", "origin")
    match = re.search(r"github\.com[/:]([^/\s]+)/([^/\s]+?)(?:\.git)?$", remote)
    if not match:
        raise ReleaseNotesError(f"origin must point to a GitHub repository, found {remote!r}")
    return f"{match.group(1)}/{match.group(2)}"


def release_tags(root: Path) -> list[str]:
    tags = [tag for tag in git(root, "tag", "--list", "v*").splitlines() if parse_tag(tag)]
    return sorted(tags, key=lambda tag: parse_tag(tag) or (0, 0, 0))


def previous_tag(root: Path, version: str) -> str | None:
    current = version_key(version)
    candidates = [tag for tag in release_tags(root) if (parse_tag(tag) or current) < current]
    return candidates[-1] if candidates else None


def commit_sha(root: Path, ref: str = "HEAD") -> str:
    return git(root, "rev-parse", ref)


def classify_commit(subject: str) -> str:
    match = re.match(
        r"^(feat|fix|perf|refactor|docs|build|ci|chore|test|style)(?:\([^)]*\))?!?:",
        subject,
    )
    kind = match.group(1) if match else "other"
    return {
        "feat": "features",
        "fix": "fixes",
        "perf": "performance",
        "refactor": "refactoring",
        "docs": "documentation",
        "build": "maintenance",
        "ci": "maintenance",
        "chore": "maintenance",
        "test": "maintenance",
        "style": "maintenance",
    }.get(kind, "other")


def commits_between(root: Path, previous: str | None, current_ref: str) -> list[dict[str, str]]:
    revision = f"{previous}..{current_ref}" if previous else current_ref
    output = git(root, "log", "--reverse", "--format=%H%x1f%s%x1f%b%x1e", revision)
    commits: list[dict[str, str]] = []
    for raw_record in output.split("\x1e"):
        record = raw_record.strip()
        if not record:
            continue
        sha, separator, remainder = record.partition("\x1f")
        if not separator:
            continue
        subject, separator, body = remainder.partition("\x1f")
        commits.append(
            {
                "sha": sha.strip(),
                "subject": subject.strip(),
                "body": body.strip() if separator else "",
                "category": classify_commit(subject.strip()),
            }
        )
    return commits


def full_changelog_url(repo: str, tag: str, previous: str | None) -> str:
    if previous:
        return f"https://github.com/{repo}/compare/{previous}...{tag}"
    return f"https://github.com/{repo}/commits/{tag}"


def build_facts(
    root: Path, repo: str, version: str, *, current_ref: str = "HEAD"
) -> dict[str, Any]:
    tag = tag_for(version)
    previous = previous_tag(root, version)
    commits = commits_between(root, previous, current_ref)
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for commit in commits:
        grouped[commit["category"]].append(commit)
    return {
        "version": version,
        "tag": tag,
        "repo": repo,
        "head": commit_sha(root, current_ref),
        "previous_tag": previous,
        "full_changelog": full_changelog_url(repo, tag, previous),
        "groups": {CATEGORY_TITLES[key]: value for key, value in grouped.items()},
        "commits": commits,
    }


def release_notes_prefix(tag: str) -> str:
    return "\n".join(
        (
            f"# TokenLedger {tag}",
            "",
            MACOS_FIRST_LAUNCH_NOTICE,
            "",
            "```bash",
            MACOS_QUARANTINE_COMMAND,
            "```",
            "",
            "Open TokenLedger again after the command completes.",
        )
    )


def render_draft(facts: dict[str, Any]) -> str:
    lines = [release_notes_prefix(facts["tag"]), "", "## Release notes", ""]
    groups = facts.get("groups", {})
    for title in CATEGORY_TITLES.values():
        commits = groups.get(title, [])
        if not commits:
            continue
        lines.append(f"### {title}")
        for commit in commits:
            lines.append(f"- {commit['subject']} ({commit['sha'][:7]})")
        lines.append("")
    if not any(groups.values()):
        lines.extend(("- Initial release.", ""))
    lines.extend((CHINESE_SECTION_HEADING, ""))
    lines.append(f"**Full Changelog**: {facts['full_changelog']}")
    return "\n".join(lines) + "\n"


def validate_notes(notes: str, facts: dict[str, Any]) -> None:
    version = facts.get("version")
    tag = facts.get("tag")
    changelog = facts.get("full_changelog")
    if not isinstance(version, str) or not isinstance(tag, str) or not isinstance(changelog, str):
        raise ReleaseNotesError("Release facts are missing version, tag, or changelog data")
    if not notes.strip():
        raise ReleaseNotesError("Release Notes must not be empty")
    expected_prefix = release_notes_prefix(tag)
    if not notes.startswith(f"{expected_prefix}\n\n"):
        raise ReleaseNotesError(
            f"Release Notes must start with the required macOS first-launch instructions for {tag}"
        )
    expected_changelog = f"**Full Changelog**: {changelog}"
    if expected_changelog not in notes:
        raise ReleaseNotesError(f"Release Notes must contain: {expected_changelog}")
    section_marker = f"\n{CHINESE_SECTION_HEADING}\n"
    if notes.count(section_marker) != 1:
        raise ReleaseNotesError(
            f"Release Notes must contain exactly one {CHINESE_SECTION_HEADING} section"
        )
    english_notes, chinese_and_footer = notes.split(section_marker, 1)
    if CJK_RE.search(english_notes):
        raise ReleaseNotesError("English Release Notes must not contain CJK text")
    if chinese_and_footer.count(expected_changelog) != 1:
        raise ReleaseNotesError(f"Release Notes must contain: {expected_changelog}")
    if PLACEHOLDER_RE.search(notes):
        raise ReleaseNotesError("Release Notes contain an unresolved placeholder")
    chinese_notes, footer = chinese_and_footer.rsplit(expected_changelog, 1)
    if not chinese_notes.strip() or not CJK_RE.search(chinese_notes):
        raise ReleaseNotesError(
            f"{CHINESE_SECTION_HEADING} must contain a non-empty Chinese description"
        )
    if footer.strip():
        raise ReleaseNotesError("Full Changelog must be the final line of Release Notes")


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def write_json(path: Path, value: dict[str, Any]) -> None:
    write_text(path, json.dumps(value, indent=2, ensure_ascii=True) + "\n")
