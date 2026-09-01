from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import token_ledger_release as helper


class ReleaseNotesHelperTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "package.json").write_text(
            json.dumps({"name": "tokenledger", "version": "0.1.0"}, indent=2) + "\n",
            encoding="utf-8",
        )

    def test_read_versions_requires_valid_string_version(self) -> None:
        self.assertEqual(helper.read_versions(self.root), "0.1.0")
        (self.root / "package.json").write_text('{"version": 1}\n', encoding="utf-8")
        with self.assertRaisesRegex(helper.ReleaseNotesError, "string version"):
            helper.read_versions(self.root)

    def test_set_versions_updates_package_json_and_preserves_formatting(self) -> None:
        updated = helper.set_versions(self.root, "0.2.0")
        self.assertEqual({"package.json"}, set(updated))
        self.assertEqual(helper.read_versions(self.root), "0.2.0")
        content = (self.root / "package.json").read_text(encoding="utf-8")
        self.assertIn('  "version": "0.2.0"', content)
        self.assertIn('  "name": "tokenledger"', content)

    def test_set_versions_requires_a_strictly_greater_version(self) -> None:
        with self.assertRaisesRegex(helper.ReleaseNotesError, "greater than"):
            helper.set_versions(self.root, "0.1.0")
        with self.assertRaisesRegex(helper.ReleaseNotesError, "greater than"):
            helper.set_versions(self.root, "0.0.9")
        with self.assertRaisesRegex(helper.ReleaseNotesError, "X.Y.Z"):
            helper.set_versions(self.root, "0.2")

    def test_semantic_tags_choose_greatest_lower_version(self) -> None:
        with mock.patch.object(
            helper, "release_tags", return_value=["v0.1.0", "v0.9.0", "v1.0.0"]
        ):
            self.assertEqual(helper.previous_tag(self.root, "1.0.0"), "v0.9.0")

    def test_initial_release_uses_tag_commit_history_url(self) -> None:
        self.assertEqual(
            helper.full_changelog_url("iohao/token-ledger", "v0.1.0", None),
            "https://github.com/iohao/token-ledger/commits/v0.1.0",
        )

    def test_render_and_validate_bilingual_notes(self) -> None:
        facts = self.facts()
        rendered = helper.render_draft(facts)
        expected_prefix = helper.release_notes_prefix("v0.1.0") + "\n\n"
        self.assertTrue(rendered.startswith(expected_prefix))
        self.assertIn(helper.CHINESE_SECTION_HEADING, rendered)
        with self.assertRaisesRegex(helper.ReleaseNotesError, "Chinese description"):
            helper.validate_notes(rendered, facts)

        bilingual = self.add_chinese(rendered)
        helper.validate_notes(bilingual, facts)
        with self.assertRaisesRegex(helper.ReleaseNotesError, "must not contain CJK"):
            helper.validate_notes(bilingual.replace("Features", "新功能"), facts)
        with self.assertRaisesRegex(helper.ReleaseNotesError, "placeholder"):
            helper.validate_notes(bilingual.replace("本版本新增发布说明", "TODO"), facts)

    def test_notes_require_a_single_chinese_section(self) -> None:
        facts = self.facts(groups={})
        rendered = helper.render_draft(facts)
        without_section = rendered.replace(f"\n{helper.CHINESE_SECTION_HEADING}\n", "")
        with self.assertRaisesRegex(helper.ReleaseNotesError, "exactly one"):
            helper.validate_notes(without_section, facts)

        bilingual = self.add_chinese(rendered)
        duplicated = bilingual.replace(
            "\n**Full Changelog**",
            f"\n{helper.CHINESE_SECTION_HEADING}\n\n更多中文说明。\n\n**Full Changelog**",
            1,
        )
        with self.assertRaisesRegex(helper.ReleaseNotesError, "exactly one"):
            helper.validate_notes(duplicated, facts)

    def test_notes_require_exact_first_launch_instructions_after_heading(self) -> None:
        facts = self.facts(groups={})
        rendered = helper.render_draft(facts)
        self.assertIn(
            'sudo xattr -dr com.apple.quarantine "/Applications/TokenLedger.app"', rendered
        )

        with self.assertRaisesRegex(helper.ReleaseNotesError, "first-launch instructions"):
            helper.validate_notes(rendered.replace(f"{helper.MACOS_QUARANTINE_COMMAND}\n", ""), facts)
        with self.assertRaisesRegex(helper.ReleaseNotesError, "first-launch instructions"):
            helper.validate_notes(
                rendered.replace(
                    "# TokenLedger v0.1.0\n\n",
                    "# TokenLedger v0.1.0\n\nAn unrelated overview.\n\n",
                ),
                facts,
            )

    def test_notes_require_exact_changelog_as_the_final_line(self) -> None:
        facts = self.facts(groups={})
        bilingual = self.add_chinese(helper.render_draft(facts))
        with self.assertRaisesRegex(helper.ReleaseNotesError, "Full Changelog"):
            helper.validate_notes(
                bilingual.replace(
                    "**Full Changelog**: https://github.com/iohao/token-ledger/commits/v0.1.0\n",
                    "",
                ),
                facts,
            )
        with self.assertRaisesRegex(helper.ReleaseNotesError, "final line"):
            helper.validate_notes(bilingual + "Unexpected footer\n", facts)

    @staticmethod
    def facts(groups: dict[str, list[dict[str, str]]] | None = None) -> dict[str, object]:
        return {
            "version": "0.1.0",
            "tag": "v0.1.0",
            "full_changelog": "https://github.com/iohao/token-ledger/commits/v0.1.0",
            "groups": groups
            if groups is not None
            else {"Features": [{"subject": "feat: add releases", "sha": "a" * 40}]},
        }

    @staticmethod
    def add_chinese(rendered: str) -> str:
        return rendered.replace(
            f"{helper.CHINESE_SECTION_HEADING}\n\n",
            f"{helper.CHINESE_SECTION_HEADING}\n\n本版本新增发布说明。\n\n",
            1,
        )


if __name__ == "__main__":
    unittest.main()
