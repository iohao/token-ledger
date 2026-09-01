from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from unittest import mock

import release


class ReleaseStateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state_root = self.root / "state"
        self.notes = self.root / "release-notes.md"
        self.notes.write_text(
            "# TokenLedger v0.1.0\n\n"
            "**Full Changelog**: https://example.test/commits/v0.1.0\n",
            encoding="utf-8",
        )
        self.state = {
            "version": "0.1.0",
            "tag": "v0.1.0",
            "repo": release.EXPECTED_REPO,
            "head": "abc123",
            "notes_file": str(self.notes),
            "notes_sha256": None,
            "stages": {stage: stage == "prepared" for stage in release.STAGES},
        }
        self.context = release.ReleaseContext(
            root=self.root,
            repo=release.EXPECTED_REPO,
            version="0.1.0",
            tag="v0.1.0",
            head="abc123",
        )

    def test_state_store_round_trip(self) -> None:
        with mock.patch.object(release, "STATE_ROOT", self.state_root):
            store = release.StateStore("v0.1.0")
            store.save(dict(self.state))
            loaded = store.load()
        self.assertEqual("v0.1.0", loaded["tag"])
        self.assertIn("updated_at", loaded)

    def test_locked_notes_cannot_change(self) -> None:
        state = dict(self.state)
        release.lock_release_notes(state)
        self.notes.write_text("# TokenLedger v0.1.0\nchanged\n", encoding="utf-8")
        with self.assertRaisesRegex(release.ReleaseError, "changed after publishing started"):
            release.lock_release_notes(state)

    def test_validate_prepared_notes_has_no_publish_side_effects(self) -> None:
        with mock.patch.object(release.StateStore, "load", return_value=self.state), mock.patch.object(
            release, "validate_state_before_publish"
        ) as validate_state, mock.patch.object(
            release, "validate_reviewed_notes", return_value="reviewed notes"
        ) as validate_notes:
            content = release.validate_prepared_notes(self.root, "0.1.0")
        self.assertEqual(content, "reviewed notes")
        validate_state.assert_called_once_with(self.root, self.state)
        validate_notes.assert_called_once_with(self.state)

    def test_existing_tag_must_match_head_and_notes(self) -> None:
        with mock.patch.object(release, "tag_exists", return_value=True), mock.patch.object(
            release, "git", side_effect=["tag", "abc123", "reviewed notes"]
        ):
            release.validate_existing_annotated_tag(
                self.root, "v0.1.0", "abc123", "reviewed notes"
            )
        with mock.patch.object(release, "tag_exists", return_value=True), mock.patch.object(
            release, "git", side_effect=["tag", "other"]
        ):
            with self.assertRaisesRegex(release.ReleaseError, "prepared HEAD"):
                release.validate_existing_annotated_tag(
                    self.root, "v0.1.0", "abc123", "reviewed notes"
                )

    def test_existing_tag_allows_git_stripped_markdown_heading(self) -> None:
        reviewed_notes = self.notes.read_text(encoding="utf-8")
        tag_body = "**Full Changelog**: https://example.test/commits/v0.1.0"
        with mock.patch.object(release, "tag_exists", return_value=True), mock.patch.object(
            release, "git", side_effect=["tag", "abc123", tag_body]
        ):
            release.validate_existing_annotated_tag(
                self.root, "v0.1.0", "abc123", reviewed_notes
            )

    def test_create_tag_preserves_markdown_heading(self) -> None:
        reviewed_notes = self.notes.read_text(encoding="utf-8")
        with mock.patch.object(
            release, "tag_exists", side_effect=[False, False]
        ), mock.patch.object(release, "run") as run, mock.patch.object(
            release, "validate_remote_tag"
        ):
            release.create_and_push_tag(self.context, self.state, reviewed_notes)
        self.assertIn("--cleanup=verbatim", run.call_args_list[0].args[0])

    def test_publish_pushes_tag_and_returns_without_waiting_for_actions(self) -> None:
        state = dict(self.state, stages=dict(self.state["stages"]))
        reviewed_notes = self.notes.read_text(encoding="utf-8")
        with mock.patch.object(release.StateStore, "load", return_value=state), mock.patch.object(
            release.StateStore, "save"
        ) as save, mock.patch.object(
            release, "validate_state_before_publish", return_value=self.context
        ), mock.patch.object(
            release, "validate_reviewed_notes", return_value=reviewed_notes
        ), mock.patch.object(
            release, "create_and_push_tag"
        ) as push_tag, mock.patch("builtins.print") as print_output:
            result = release.publish(self.root, "0.1.0")

        push_tag.assert_called_once_with(self.context, state, reviewed_notes)
        self.assertTrue(result["stages"]["tag-pushed"])
        self.assertEqual(release.sha256(self.notes), result["notes_sha256"])
        self.assertGreaterEqual(save.call_count, 2)
        printed = "\n".join(str(call.args[0]) for call in print_output.call_args_list)
        self.assertIn("asynchronously", printed)
        self.assertIn("actions/workflows/release.yml", printed)

    def test_resume_with_pushed_tag_only_revalidates_remote_state(self) -> None:
        state = dict(self.state, stages={"prepared": True, "tag-pushed": True})
        state["notes_sha256"] = release.sha256(self.notes)
        reviewed_notes = self.notes.read_text(encoding="utf-8")
        with mock.patch.object(release.StateStore, "load", return_value=state), mock.patch.object(
            release.StateStore, "save"
        ), mock.patch.object(
            release, "context_from_pushed_tag", return_value=self.context
        ), mock.patch.object(
            release, "validate_reviewed_notes", return_value=reviewed_notes
        ), mock.patch.object(
            release, "validate_existing_annotated_tag"
        ) as validate_tag, mock.patch.object(
            release, "validate_remote_tag"
        ) as validate_remote, mock.patch.object(
            release, "create_and_push_tag"
        ) as push_tag, mock.patch("builtins.print"):
            release.publish(self.root, "0.1.0", resume=True)

        push_tag.assert_not_called()
        validate_tag.assert_called_once_with(self.root, "v0.1.0", "abc123", reviewed_notes)
        validate_remote.assert_called_once_with(self.root, "v0.1.0", "abc123")

    def test_preflight_does_not_query_github_actions(self) -> None:
        with mock.patch.object(release, "require_commands"), mock.patch.object(
            release, "assert_clean_main", return_value=("abc123", "abc123")
        ), mock.patch.object(
            release.notes, "repo_from_origin", return_value=release.EXPECTED_REPO
        ), mock.patch.object(release, "assert_github_access"), mock.patch.object(
            release.notes, "read_versions", return_value="0.1.0"
        ), mock.patch.object(release, "tag_exists", return_value=False), mock.patch.object(
            release, "github_release_exists", return_value=False
        ):
            context = release.preflight(self.root)
        self.assertEqual("abc123", context.head)
        self.assertEqual("v0.1.0", context.tag)

    def test_github_access_requires_expected_public_repo(self) -> None:
        with self.assertRaisesRegex(release.ReleaseError, release.EXPECTED_REPO):
            release.assert_github_access(self.root, "someone/token-ledger")

        auth = CompletedProcess(["gh"], 0, "", "")
        with mock.patch.object(release, "run", return_value=auth), mock.patch.object(
            release,
            "json_output",
            return_value={"nameWithOwner": release.EXPECTED_REPO, "visibility": "PRIVATE"},
        ):
            with self.assertRaisesRegex(release.ReleaseError, "must be public"):
                release.assert_github_access(self.root, release.EXPECTED_REPO)

        with mock.patch.object(release, "run", return_value=auth), mock.patch.object(
            release,
            "json_output",
            return_value={"nameWithOwner": release.EXPECTED_REPO, "visibility": "PUBLIC"},
        ):
            release.assert_github_access(self.root, release.EXPECTED_REPO)


if __name__ == "__main__":
    unittest.main()
